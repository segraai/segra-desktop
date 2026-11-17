// Talks to claude-mem (https://github.com/thedotmack/claude-mem) through its
// CLI: `claude-mem hook <platform> <event>` reads a JSON hook input on stdin
// and, for context events, prints `hookSpecificOutput.additionalContext`.
// An unknown platform name uses claude-mem's generic ("raw") input shape and
// is stored as the session's source, so Segra sessions show up as "segra".

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export const PLATFORM = "segra";

/** Fields of claude-mem's raw hook input that this plugin sends. */
export interface ClaudeMemHookInput {
	sessionId: string;
	cwd: string;
	prompt?: string;
	toolName?: string;
	toolInput?: unknown;
	toolResponse?: unknown;
	toolUseId?: string;
	lastAssistantMessage?: string;
}

export type ClaudeMemEvent =
	| "session-init"
	| "context"
	| "observation"
	| "summarize"
	| "session-end";

const MAX_FIELD_CHARS = 50_000;

function executableNames(name: string): string[] {
	return process.platform === "win32"
		? [`${name}.exe`, `${name}.cmd`, name]
		: [name];
}

function findOnPath(name: string, env: NodeJS.ProcessEnv): string | undefined {
	for (const dir of (env.PATH ?? "").split(delimiter)) {
		if (!dir) continue;
		for (const file of executableNames(name)) {
			const candidate = join(dir, file);
			if (existsSync(candidate)) return candidate;
		}
	}
	return undefined;
}

/**
 * Finds the claude-mem CLI. A desktop app started from the dock or a launcher
 * gets a minimal PATH, so the usual install locations are checked as well.
 */
export function findClaudeMem(
	env: NodeJS.ProcessEnv = process.env,
	home = homedir(),
): string | undefined {
	const explicit = env.CLAUDE_MEM_BIN?.trim();
	if (explicit) return existsSync(explicit) ? explicit : undefined;
	const onPath = findOnPath("claude-mem", env);
	if (onPath) return onPath;
	const dirs = [
		join(home, ".local", "bin"),
		join(home, ".bun", "bin"),
		"/usr/local/bin",
		"/opt/homebrew/bin",
	];
	for (const dir of dirs) {
		for (const file of executableNames("claude-mem")) {
			const candidate = join(dir, file);
			if (existsSync(candidate)) return candidate;
		}
	}
	return undefined;
}

/** Keeps a large tool input or output from flooding claude-mem. */
export function clip(value: unknown): unknown {
	if (value === undefined || value === null) return value;
	const text = typeof value === "string" ? value : JSON.stringify(value);
	if (text === undefined || text.length <= MAX_FIELD_CHARS) return value;
	return `${text.slice(0, MAX_FIELD_CHARS)}\n[truncated]`;
}

/**
 * Runs one claude-mem hook event and resolves with its stdout. Never rejects:
 * memory is best-effort and must not break a Segra session.
 */
export function runClaudeMemHook(
	binary: string,
	event: ClaudeMemEvent,
	input: ClaudeMemHookInput,
	timeoutMs: number,
	env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
	return new Promise((resolve) => {
		let stdout = "";
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(stdout);
		};
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(binary, ["hook", PLATFORM, event], {
				stdio: ["pipe", "pipe", "ignore"],
				env,
				windowsHide: true,
			});
		} catch {
			resolve("");
			return;
		}
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			finish();
		}, timeoutMs);
		child.stdout?.on("data", (chunk) => {
			stdout += chunk;
		});
		child.on("error", finish);
		child.on("close", finish);
		child.stdin?.on("error", () => {});
		child.stdin?.end(JSON.stringify(input));
	});
}

/** Reads `hookSpecificOutput.additionalContext` from a context event's stdout. */
export function additionalContextFrom(stdout: string): string {
	try {
		const parsed = JSON.parse(stdout) as {
			hookSpecificOutput?: { additionalContext?: unknown };
		};
		const context = parsed?.hookSpecificOutput?.additionalContext;
		return typeof context === "string" ? context : "";
	} catch {
		return "";
	}
}

/**
 * The text the user typed, or undefined for messages that aren't user
 * prompts. Segra wraps typed prompts as `<user_input mode="...">...</user_input>`
 * and adds runtime reminders as user messages starting with `[SYSTEM]`.
 */
export function userPromptText(text: string | undefined): string | undefined {
	if (typeof text !== "string") return undefined;
	const match = /^\s*<user_input\b[^>]*>([\s\S]*)<\/user_input>\s*$/.exec(text);
	const prompt = (match ? match[1] : text).trim();
	if (!prompt || prompt.startsWith("[SYSTEM]")) return undefined;
	return prompt;
}
