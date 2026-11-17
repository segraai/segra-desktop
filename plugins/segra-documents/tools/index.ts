import { createReadDocumentTool } from "./document.ts";
import type { RemoteOcr } from "./document-core.ts";
import type { SegraToolConfig } from "./tool-config.ts";
import { WRITE_WORKBOOK_TOOL } from "./workbook.ts";

export type {
	ReadDocumentOptions,
	RemoteOcr,
	RemoteOcrImage,
} from "./document-core.ts";
export type { SegraToolConfig } from "./tool-config.ts";

/**
 * The document tools, as plain definitions. Segra Desktop imports this file
 * from its bundled copy (`bin/segra-plugins/segra-documents/tools/index.ts`)
 * and adds the tools to every local session; the plugin entry (`index.ts`)
 * registers the same definitions for the CLI.
 */
export interface SegraDocumentToolsOptions {
	/** Tried before offline OCR; undefined or a throw falls back to tesseract. */
	remoteOcr?: RemoteOcr;
}

export function createSegraDocumentTools(
	options: SegraDocumentToolsOptions = {},
): readonly SegraToolConfig[] {
	return [
		createReadDocumentTool({ remoteOcr: options.remoteOcr }),
		WRITE_WORKBOOK_TOOL,
	];
}

export const SEGRA_DOCUMENT_TOOLS: readonly SegraToolConfig[] =
	createSegraDocumentTools();
