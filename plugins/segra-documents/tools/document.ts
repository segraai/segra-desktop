import { type ReadDocumentOptions, readDocument } from "./document-core.ts";
import type { SegraToolConfig } from "./tool-config.ts";

export function createReadDocumentTool(
	options: ReadDocumentOptions = {},
): SegraToolConfig {
	return {
		name: "read_document",
		description:
			"Reads the text of a PDF, or of a scanned or photographed document (.png, .jpg, .jpeg), using the built-in reader and offline OCR. " +
			"This is the way to read PDFs and scans (T4 slips, receipts, invoices, bank statements). Never write Python or shell commands for that. " +
			'Pass an absolute file path. Returns one entry per page with the text, `source` ("text" = the PDF\'s own text, "ocr" = recognised from an image by offline OCR, "segra-ocr" = recognised from an image by Segra\'s private TEE OCR model, "none" = nothing could be read) and, for offline OCR, `ocrConfidence` (0-100). ' +
			"OCR can misread digits, so check amounts against totals and tell the user which values came from OCR. " +
			"At most 30 pages per call; use `pages` ({ from, to }, 1-based) to read more. Scanned pages are slow (several seconds each). Password-protected PDFs cannot be opened.",
		inputSchema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Absolute path to a .pdf, .png, .jpg or .jpeg file.",
				},
				pages: {
					type: "object",
					description:
						"Optional 1-based inclusive page range. Default: all pages (max 30 per call).",
					properties: {
						from: { type: "number" },
						to: { type: "number" },
					},
					required: ["from", "to"],
				},
			},
			required: ["path"],
		},
		timeoutMs: 300000,
		// Failures (locked PDF, missing file) are not fixed by trying again.
		retryable: false,
		execute: async (input: {
			path: string;
			pages?: { from: number; to: number };
		}) => {
			// Plain JSON only: it crosses the worker-thread boundary.
			return JSON.parse(JSON.stringify(await readDocument(input, options)));
		},
	};
}

export const READ_DOCUMENT_TOOL: SegraToolConfig = createReadDocumentTool();
