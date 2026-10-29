import { normalizeToolName } from "@cline/ui/components/agent-chat/tool-summary";
import type { SettingsSection } from "@/components/views/settings/sections";

/**
 * Segra Desktop's privacy copy, in one place so the chat, the composer and
 * Settings → Privacy say the same thing. Keep every line literally true:
 *
 * - Chats, files and history are stored on this computer (the data dir).
 * - With Segra, prompts and the files the agent reads go to a 0G provider's
 *   TEE that this computer attested itself (segra-attest.ts). Segra's server
 *   only mints the session and records token counts (segra.ts).
 * - Tools run on this computer, but some reach outside services by design.
 */

export const PRIVATE_PROMISE =
	"Your chats and files stay on this computer. When the AI needs to read them, they go only to sealed, secure hardware that this computer checks first. No one can see inside it, not the company running it and not Segra.";

/** Built-in local models: the model runs here (sidecar/local-models.ts). */
export const LOCAL_PROMISE =
	"Runs on this computer. Your chats, your files and the model all stay here, and nothing you type leaves it.";

/** The one line that offers Segra next to local models. */
export const SEGRA_ONE_LINER =
	"Want more powerful models without the hardware? Use Segra. Your chats go only to sealed, secure hardware this computer checks first, so not even Segra can read them.";

export const NOT_PRIVATE_PROMISE = (providerName: string) =>
	`Your messages and the files the agent reads are sent to ${providerName}'s servers, which can read them and may keep them under their own terms.`;

export type ToolPrivacyNote = {
	/** Groups notes so a run shows each one once. */
	kind: "search" | "fetch" | "mcp" | "provider";
	text: string;
};

const PROVIDER_SIDE_TOOLS = new Set(["web_search", "image_generation"]);

/**
 * What a tool call reveals outside this computer, or null for tools that only
 * touch local files and commands. MCP tools are named `server__tool` by core
 * (mcp/name-transform.ts).
 */
export function toolPrivacyNote(toolName: string): ToolPrivacyNote | null {
	const name = normalizeToolName(toolName);
	if (name === "search_web") {
		return {
			kind: "search",
			text: "Searched from this computer, not by an AI company. The search engine (DuckDuckGo) sees the search terms, like any search you type yourself.",
		};
	}
	if (name === "fetch_web_content") {
		return {
			kind: "fetch",
			text: "Opened from this computer. The website sees the visit, like opening the page in your browser.",
		};
	}
	if (PROVIDER_SIDE_TOOLS.has(name)) {
		return {
			kind: "provider",
			text: "Run by the model provider on its own servers, so the provider sees what was asked.",
		};
	}
	if (
		name.includes("__") ||
		name === "mcp" ||
		name.startsWith("mcp_") ||
		name.startsWith("mcp-")
	) {
		return {
			kind: "mcp",
			text: "An MCP tool you installed. It may connect to an outside service and send it what the tool was given.",
		};
	}
	return null;
}

export const EXTENSIONS_NOTE =
	"MCP servers and plugins run on this computer, but many connect to outside services (GitHub, Slack, a company's API…) and send them what the agent passes in. Only install ones you trust, and check what each connects to.";

export const VOICE_NOTE = (providerName: string) =>
	`Your recording is sent to ${providerName} to turn it into text, so ${providerName} hears it. It doesn't get the secure-hardware protection your chats have.`;

/** Opens a Settings section from anywhere (handled in app/page.tsx). */
export const OPEN_SETTINGS_SECTION_EVENT = "segra-open-settings-section";

export function openSettingsSection(section: SettingsSection) {
	window.dispatchEvent(
		new CustomEvent<SettingsSection>(OPEN_SETTINGS_SECTION_EVENT, {
			detail: section,
		}),
	);
}
