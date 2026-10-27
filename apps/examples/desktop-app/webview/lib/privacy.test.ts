// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	OPEN_SETTINGS_SECTION_EVENT,
	openSettingsSection,
	toolPrivacyNote,
} from "./privacy";

describe("toolPrivacyNote", () => {
	it("says the search engine sees web searches", () => {
		const note = toolPrivacyNote("search_web");
		expect(note?.kind).toBe("search");
		expect(note?.text).toContain("(DuckDuckGo) sees the search terms");
	});

	it("says the website sees fetched pages, including aliases", () => {
		expect(toolPrivacyNote("fetch_web_content")?.kind).toBe("fetch");
		expect(toolPrivacyNote("web_fetch")?.kind).toBe("fetch");
	});

	it("flags MCP tools, which core names server__tool", () => {
		expect(toolPrivacyNote("github__get_pull_request_diff")?.kind).toBe("mcp");
		expect(toolPrivacyNote("mcp_linear_search")?.kind).toBe("mcp");
	});

	it("flags tools the model provider runs on its own servers", () => {
		expect(toolPrivacyNote("web_search")?.kind).toBe("provider");
	});

	it("has no note for tools that stay on this computer", () => {
		for (const name of [
			"read_files",
			"editor",
			"apply_patch",
			"search_codebase",
			"run_commands",
			"ask_question",
		]) {
			expect(toolPrivacyNote(name)).toBeNull();
		}
	});
});

describe("openSettingsSection", () => {
	afterEach(() => vi.restoreAllMocks());

	it("asks the app to open a Settings section", () => {
		const listener = vi.fn();
		window.addEventListener(OPEN_SETTINGS_SECTION_EVENT, listener);
		openSettingsSection("Privacy");
		window.removeEventListener(OPEN_SETTINGS_SECTION_EVENT, listener);
		expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toBe("Privacy");
	});
});
