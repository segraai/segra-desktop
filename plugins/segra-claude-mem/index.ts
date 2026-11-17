import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentPlugin } from "@cline/core";
import {
	additionalContextFrom,
	type ClaudeMemHookInput,
	clip,
	findClaudeMem,
	runClaudeMemHook,
	userPromptText,
} from "./claude-mem.ts";

// Connects Segra sessions to claude-mem, the memory system many people run
// with Claude Code. Sessions are recorded into the same memory, the agent gets
// relevant past work at the start of each run, and claude-mem's search tools
// are available through its MCP server. Requires claude-mem to be installed;
// without it the plugin does nothing.

type MessageContent = readonly { type: string; text?: string }[] | string;

interface SnapshotLike {
	agentId?: string;
	conversationId?: string;
	runId?: string;
	parentAgentId?: string | null;
	messages?: readonly {
		role: string;
		content: MessageContent;
		metadata?: { displayRole?: string };
	}[];
}

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));

/** Set in setup(). Plugins get a fresh module copy per session. */
const state: {
	binary?: string;
	cwd: string;
	seenSessions: Set<string>;
	recordedPrompts: Set<string>;
} = {
	cwd: process.cwd(),
	seenSessions: new Set(),
	recordedPrompts: new Set(),
};

function sessionIdOf(snapshot: SnapshotLike): string | undefined {
	return snapshot.conversationId ?? snapshot.runId ?? snapshot.agentId;
}

/** Team and sub-agents run under their own ids; only the root agent is recorded. */
function isRootAgent(snapshot: SnapshotLike): boolean {
	return !snapshot.parentAgentId;
}

function textOf(content: MessageContent): string {
	if (typeof content === "string") return content;
	return content
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("");
}

/** The newest prompt the user typed, skipping injected hook context. */
function latestUserPrompt(snapshot: SnapshotLike): string | undefined {
	const messages = snapshot.messages ?? [];
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role !== "user") continue;
		if (message.metadata?.displayRole === "system") continue;
		const prompt = userPromptText(textOf(message.content));
		if (prompt) return prompt;
	}
	return undefined;
}

function base(sessionId: string): ClaudeMemHookInput {
	return { sessionId, cwd: state.cwd };
}

/**
 * Records a prompt once. Depending on how a session is driven, the prompt is
 * visible at run start, as an added message, or both.
 */
async function recordPrompt(sessionId: string, prompt: string): Promise<void> {
	if (!state.binary) return;
	const key = `${sessionId}\0${prompt}`;
	if (state.recordedPrompts.has(key)) return;
	state.recordedPrompts.add(key);
	state.seenSessions.add(sessionId);
	await runClaudeMemHook(
		state.binary,
		"session-init",
		{ ...base(sessionId), prompt },
		15_000,
	);
}

/** Starts claude-mem's MCP search server through the bundled launcher. */
function mcpServerCommand(): { command: string; args: string[] } | undefined {
	const launcher = join(PLUGIN_DIR, "mcp-server.cjs");
	if (!existsSync(launcher)) return undefined;
	const home = homedir();
	const nodeCandidates = [
		join(home, ".local", "bin", "node"),
		"/usr/local/bin/node",
		"/opt/homebrew/bin/node",
		"/usr/bin/node",
	];
	const node = nodeCandidates.find((candidate) => existsSync(candidate));
	if (node) return { command: node, args: [launcher] };
	// Fall back to the runtime hosting this plugin when it is Node or Bun.
	const runtime = basename(process.execPath).toLowerCase();
	if (runtime.startsWith("node") || runtime.startsWith("bun")) {
		return { command: process.execPath, args: [launcher] };
	}
	return undefined;
}

function hasClaudeMemPluginInstall(): boolean {
	const configDir =
		process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude");
	return (
		existsSync(
			join(configDir, "plugins", "cache", "thedotmack", "claude-mem"),
		) ||
		existsSync(
			join(configDir, "plugins", "marketplaces", "thedotmack", "plugin"),
		)
	);
}

const plugin: AgentPlugin = {
	name: "segra-claude-mem",
	manifest: {
		capabilities: ["hooks", "mcp"],
	},

	setup(api, ctx) {
		state.cwd = ctx.cwd ?? ctx.workspaceInfo?.rootPath ?? process.cwd();
		state.binary = findClaudeMem();
		if (!state.binary) {
			ctx.logger?.log?.(
				"segra-claude-mem: claude-mem is not installed; memory is off for this session",
			);
			return;
		}

		const mcp = hasClaudeMemPluginInstall() ? mcpServerCommand() : undefined;
		if (mcp) {
			api.registerMcpServer({
				name: "claude-mem",
				transport: { type: "stdio", ...mcp },
			});
		}

		ctx.onDispose?.(async () => {
			const binary = state.binary;
			if (!binary) return;
			await Promise.all(
				[...state.seenSessions].map((sessionId) =>
					runClaudeMemHook(binary, "session-end", base(sessionId), 15_000),
				),
			);
		});
	},

	hooks: {
		async beforeRun({ snapshot }) {
			const binary = state.binary;
			const sessionId = sessionIdOf(snapshot);
			if (!binary || !sessionId || !isRootAgent(snapshot)) return undefined;
			state.seenSessions.add(sessionId);
			const prompt = latestUserPrompt(snapshot);
			if (prompt) await recordPrompt(sessionId, prompt);
			const context = additionalContextFrom(
				await runClaudeMemHook(binary, "context", base(sessionId), 30_000),
			);
			return context.trim() ? { appendContext: context } : undefined;
		},

		async onEvent(event) {
			if (event.type !== "message-added") return;
			const { message, snapshot } = event;
			if (message.role !== "user") return;
			if (message.metadata?.displayRole === "system") return;
			const sessionId = sessionIdOf(snapshot);
			if (!sessionId || !isRootAgent(snapshot)) return;
			const prompt = userPromptText(textOf(message.content as MessageContent));
			if (prompt) await recordPrompt(sessionId, prompt);
		},

		afterTool({ snapshot, toolCall, input, result }) {
			const binary = state.binary;
			const sessionId = sessionIdOf(snapshot);
			if (!binary || !sessionId || !isRootAgent(snapshot)) return undefined;
			// Not awaited: recording a tool call must not slow the agent down.
			void runClaudeMemHook(
				binary,
				"observation",
				{
					...base(sessionId),
					toolName: toolCall.toolName,
					toolInput: clip(input),
					toolResponse: clip(result.output),
					toolUseId: toolCall.toolCallId,
				},
				15_000,
			);
			return undefined;
		},

		async afterRun({ snapshot, result }) {
			const binary = state.binary;
			const sessionId = sessionIdOf(snapshot);
			if (!binary || !sessionId || !isRootAgent(snapshot)) return;
			const text = result.outputText?.trim();
			await runClaudeMemHook(
				binary,
				"summarize",
				{
					...base(sessionId),
					lastAssistantMessage: text ? String(clip(text)) : undefined,
				},
				30_000,
			);
		},
	},
};

export { plugin };
export default plugin;
