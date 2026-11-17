// Built-in document tools: `read_document` (text and offline OCR for PDFs and
// scans) and `write_workbook` (.xlsx files whose totals are formulas).
//
// The tools live in the repo's `plugins/segra-documents` and ship inside the
// app with their dependencies (`bin/segra-plugins/segra-documents`, see
// scripts/build-desktop-runtime.ts). They are not installed as a plugin: the
// backend imports them at runtime and adds them to every local session as
// extra tools. The hub routes their calls back to this process, so they run
// next to the user's files. pdf.js, tesseract.js and exceljs load worker
// scripts, WASM and data files by path, which is why the folder is imported at
// runtime instead of being bundled into the backend script.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type AgentTool, createTool } from "@cline/core";
import { createSegraRemoteOcr, type SegraRemoteOcr } from "./segra-ocr";
import { resolveSegraPluginDir } from "./segra-recommended";

export const SEGRA_DOCUMENTS_DIR_NAME = "segra-documents";

type ToolConfig = Parameters<typeof createTool>[0];

type Logger = {
	log?: (message: string, metadata?: Record<string, unknown>) => void;
};

let cached: Promise<AgentTool[]> | undefined;

/** Where the tools are, or undefined when the app was built without them. */
export function resolveDocumentToolsDir(
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const dir = resolveSegraPluginDir(SEGRA_DOCUMENTS_DIR_NAME, env);
	if (!dir) return undefined;
	const ready =
		existsSync(join(dir, "tools", "index.ts")) &&
		existsSync(join(dir, "node_modules"));
	return ready ? dir : undefined;
}

/** Imports the tool definitions from a folder and wraps them as agent tools. */
export async function importDocumentTools(
	dir: string,
	options: { remoteOcr?: SegraRemoteOcr } = {},
): Promise<AgentTool[]> {
	const entry = pathToFileURL(join(dir, "tools", "index.ts")).href;
	const module = (await import(entry)) as {
		SEGRA_DOCUMENT_TOOLS?: readonly ToolConfig[];
		createSegraDocumentTools?: (options?: {
			remoteOcr?: SegraRemoteOcr;
		}) => readonly ToolConfig[];
	};
	// Older bundles only export the static list (offline OCR only).
	const configs = module.createSegraDocumentTools
		? module.createSegraDocumentTools({ remoteOcr: options.remoteOcr })
		: (module.SEGRA_DOCUMENT_TOOLS ?? []);
	return configs.map((config) => createTool(config) as AgentTool);
}

/**
 * The built-in document tools for a local session. Loaded once per backend
 * process; an app built without them, or a failed import, gives no tools and
 * the session starts normally.
 */
export function loadDocumentTools(logger?: Logger): Promise<AgentTool[]> {
	if (!cached) {
		cached = (async () => {
			const dir = resolveDocumentToolsDir();
			if (!dir) {
				logger?.log?.("Built-in document tools are not available", {
					severity: "warn",
				});
				return [];
			}
			try {
				return await importDocumentTools(dir, {
					remoteOcr: createSegraRemoteOcr(),
				});
			} catch (error) {
				logger?.log?.("Failed to load built-in document tools", {
					dir,
					error,
					severity: "warn",
				});
				return [];
			}
		})();
	}
	return cached;
}

/** For tests. */
export function resetDocumentToolsCache(): void {
	cached = undefined;
}
