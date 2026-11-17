// Run with `bun test` from this folder. Uses a fake claude-mem that logs each
// call, so nothing touches a real memory database.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { userPromptText } from "./claude-mem.ts";

const dir = mkdtempSync(join(tmpdir(), "segra-claude-mem-"));
const logPath = join(dir, "calls.jsonl");
const fakeBin = join(dir, "claude-mem");

type Call = { event: string; input: Record<string, unknown> };

function calls(): Call[] {
	try {
		return readFileSync(logPath, "utf8")
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
	} catch {
		return [];
	}
}

async function waitForCalls(count: number): Promise<Call[]> {
	for (let attempt = 0; attempt < 50; attempt++) {
		if (calls().length >= count) return calls();
		await Bun.sleep(20);
	}
	return calls();
}

beforeAll(() => {
	writeFileSync(
		fakeBin,
		`#!/bin/sh
input=$(cat)
printf '{"event":"%s","input":%s}\\n' "$3" "$input" >> "${logPath}"
if [ "$3" = "context" ]; then
	printf '{"hookSpecificOutput":{"additionalContext":"PAST WORK: fixed the login bug"}}'
fi
`,
	);
	chmodSync(fakeBin, 0o755);
	process.env.CLAUDE_MEM_BIN = fakeBin;
});

afterAll(() => {
	delete process.env.CLAUDE_MEM_BIN;
	rmSync(dir, { recursive: true, force: true });
});

function snapshot(
	messages: unknown[] = [],
	parentAgentId: string | null = null,
) {
	return {
		agentId: "agent-1",
		conversationId: "conv-1",
		runId: "run-1",
		parentAgentId,
		messages,
	};
}

const userMessage = (text: string, displayRole?: string) => ({
	id: crypto.randomUUID(),
	role: "user",
	content: [{ type: "text", text }],
	...(displayRole ? { metadata: { displayRole } } : {}),
	createdAt: Date.now(),
});

describe("userPromptText", () => {
	it("unwraps Segra's user_input tag and skips runtime reminders", () => {
		expect(userPromptText('<user_input mode="yolo">fix\nit</user_input>')).toBe(
			"fix\nit",
		);
		expect(userPromptText("plain prompt")).toBe("plain prompt");
		expect(userPromptText("[SYSTEM] This run is not complete")).toBeUndefined();
		expect(userPromptText("   ")).toBeUndefined();
	});
});

describe("segra-claude-mem plugin", () => {
	it("records a session and injects claude-mem context", async () => {
		const { default: plugin } = await import("./index.ts");
		const registered: unknown[] = [];
		const disposers: Array<() => unknown> = [];
		type SetupArgs = Parameters<NonNullable<typeof plugin.setup>>;
		const api = {
			registerMcpServer: (server: unknown) => registered.push(server),
		} as unknown as SetupArgs[0];
		const ctx = {
			cwd: "/work/project",
			onDispose: (fn: () => unknown) => disposers.push(fn),
		} as unknown as SetupArgs[1];
		await plugin.setup?.(api, ctx);
		const hooks = plugin.hooks;
		if (!hooks) throw new Error("plugin has no hooks");

		const start = await hooks.beforeRun?.({
			snapshot: snapshot([
				userMessage('<user_input mode="act">fix the login bug</user_input>'),
				userMessage("injected", "system"),
			]),
			// biome-ignore lint/suspicious/noExplicitAny: partial runtime context
		} as any);
		expect(start).toEqual({ appendContext: "PAST WORK: fixed the login bug" });

		// The same prompt arriving as an added message is not recorded twice.
		await hooks.onEvent?.({
			type: "message-added",
			snapshot: snapshot(),
			message: userMessage(
				'<user_input mode="act">fix the login bug</user_input>',
			),
			// biome-ignore lint/suspicious/noExplicitAny: partial runtime event
		} as any);

		hooks.afterTool?.({
			snapshot: snapshot(),
			toolCall: {
				type: "tool-call",
				toolCallId: "t1",
				toolName: "read_files",
				input: {},
			},
			input: { files: ["a.ts"] },
			result: { output: "file contents" },
			// biome-ignore lint/suspicious/noExplicitAny: partial runtime context
		} as any);
		await waitForCalls(3);

		await hooks.afterRun?.({
			snapshot: snapshot(),
			result: { outputText: "Fixed it." },
			// biome-ignore lint/suspicious/noExplicitAny: partial runtime context
		} as any);
		for (const dispose of disposers) await dispose();

		const recorded = await waitForCalls(5);
		expect(recorded.map((call) => call.event)).toEqual([
			"session-init",
			"context",
			"observation",
			"summarize",
			"session-end",
		]);
		expect(recorded[0].input).toEqual({
			sessionId: "conv-1",
			cwd: "/work/project",
			prompt: "fix the login bug",
		});
		expect(recorded[2].input).toMatchObject({
			sessionId: "conv-1",
			toolName: "read_files",
			toolInput: { files: ["a.ts"] },
			toolResponse: "file contents",
			toolUseId: "t1",
		});
		expect(recorded[3].input).toMatchObject({
			lastAssistantMessage: "Fixed it.",
		});
	});

	it("ignores sub-agents", async () => {
		const { default: plugin } = await import("./index.ts");
		const before = calls().length;
		const result = await plugin.hooks?.beforeRun?.({
			snapshot: snapshot([userMessage("child task")], "parent-agent"),
			// biome-ignore lint/suspicious/noExplicitAny: partial runtime context
		} as any);
		expect(result).toBeUndefined();
		expect(calls().length).toBe(before);
	});
});
