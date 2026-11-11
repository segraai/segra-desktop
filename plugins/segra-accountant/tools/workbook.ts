import { createTool } from "@cline/core";
import { writeWorkbook } from "./workbook-core.ts";

export function createWorkbookTools() {
	return [
		createTool({
			name: "write_workbook",
			description:
				"Writes an Excel (.xlsx) workbook. Use it to put numbers extracted from documents into a spreadsheet. " +
				"IMPORTANT: never do arithmetic yourself. Every total, subtotal, tax, difference, percentage or other calculation " +
				"MUST be given as an Excel formula in `formula` (for example \"SUM(B2:B4)\" or \"Inputs!B5*0.15\"), never as a computed value. " +
				"Put only raw extracted figures in `value`. A cell has either `value` or `formula`, never both. " +
				"Use `note` to record where a figure came from (file name and page). " +
				"Dates: give an ISO string like \"2025-03-31\" together with a date `numFmt` such as \"yyyy-mm-dd\". " +
				"`path` must be absolute and end in .xlsx; existing files are only replaced when `overwrite` is true. " +
				"Formula results are calculated when the file is opened in Excel or LibreOffice.",
			inputSchema: {
				type: "object",
				properties: {
					path: { type: "string", description: "Absolute path of the .xlsx file to write." },
					overwrite: { type: "boolean", description: "Replace the file if it exists. Default false." },
					sheets: {
						type: "array",
						description: "Worksheets to create, in order.",
						items: {
							type: "object",
							properties: {
								name: { type: "string", description: "Sheet name, max 31 characters." },
								columns: {
									type: "array",
									description: "Per-column settings, in order starting at column A.",
									items: { type: "object", properties: { width: { type: "number" } } },
								},
								cells: {
									type: "array",
									items: {
										type: "object",
										properties: {
											ref: { type: "string", description: 'Cell reference such as "B7".' },
											value: {
												type: ["string", "number", "boolean", "null"],
												description: "A literal value. Not allowed together with formula.",
											},
											formula: {
												type: "string",
												description: 'Excel formula without the leading "=", e.g. "SUM(B2:B4)".',
											},
											numFmt: { type: "string", description: 'Excel number format, e.g. "#,##0.00" or "yyyy-mm-dd".' },
											bold: { type: "boolean" },
											note: { type: "string", description: "Cell comment, e.g. the source file and page." },
										},
										required: ["ref"],
									},
								},
							},
							required: ["name", "cells"],
						},
					},
				},
				required: ["path", "sheets"],
			},
			timeoutMs: 120000,
			execute: async (input: unknown) => {
				return await writeWorkbook(input);
			},
		}),
	];
}
