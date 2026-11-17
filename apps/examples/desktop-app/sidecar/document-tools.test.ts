import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	importDocumentTools,
	loadDocumentTools,
	resetDocumentToolsCache,
	resolveDocumentToolsDir,
	SEGRA_DOCUMENTS_DIR_NAME,
} from "./document-tools";

const roots: string[] = [];

function pluginsRoot(withDeps = true): string {
	const root = mkdtempSync(join(tmpdir(), "segra-doc-tools-"));
	roots.push(root);
	const dir = join(root, SEGRA_DOCUMENTS_DIR_NAME);
	mkdirSync(join(dir, "tools"), { recursive: true });
	if (withDeps) mkdirSync(join(dir, "node_modules"));
	writeFileSync(join(dir, "package.json"), '{"name":"segra-documents"}');
	writeFileSync(
		join(dir, "tools", "index.ts"),
		`export const SEGRA_DOCUMENT_TOOLS = [{
			name: "read_document",
			description: "Reads a document.",
			inputSchema: { type: "object", properties: { path: { type: "string" } } },
			timeoutMs: 300000,
			retryable: false,
			execute: async (input) => ({ read: input.path }),
		}];`,
	);
	return root;
}

afterEach(() => {
	resetDocumentToolsCache();
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe("document tools", () => {
	it("finds the bundled folder only when its dependencies are installed", () => {
		const root = pluginsRoot();
		expect(resolveDocumentToolsDir({ SEGRA_PLUGINS_DIR: root })).toBe(
			join(root, SEGRA_DOCUMENTS_DIR_NAME),
		);
		const bare = pluginsRoot(false);
		const found = resolveDocumentToolsDir({ SEGRA_PLUGINS_DIR: bare });
		expect(found).not.toBe(join(bare, SEGRA_DOCUMENTS_DIR_NAME));
	});

	it("wraps the definitions as agent tools", async () => {
		const root = pluginsRoot();
		const tools = await importDocumentTools(
			join(root, SEGRA_DOCUMENTS_DIR_NAME),
		);
		expect(tools.map((tool) => tool.name)).toEqual(["read_document"]);
		expect(tools[0]).toMatchObject({ timeoutMs: 300000, retryable: false });
		await expect(
			tools[0]?.execute({ path: "/a.pdf" }, {} as never),
		).resolves.toEqual({ read: "/a.pdf" });
	});

	it("passes the remote OCR hook to bundles that accept it", async () => {
		const root = pluginsRoot();
		writeFileSync(
			join(root, SEGRA_DOCUMENTS_DIR_NAME, "tools", "index.ts"),
			`export const SEGRA_DOCUMENT_TOOLS = [];
			export function createSegraDocumentTools(options) {
				return [{
					name: "read_document",
					description: "Reads a document.",
					inputSchema: { type: "object", properties: {} },
					execute: async () => ({ ocr: await options.remoteOcr() }),
				}];
			}`,
		);
		const tools = await importDocumentTools(
			join(root, SEGRA_DOCUMENTS_DIR_NAME),
			{ remoteOcr: async () => "remote text" },
		);
		await expect(tools[0]?.execute({}, {} as never)).resolves.toEqual({
			ocr: "remote text",
		});
	});

	it("gives no tools when the folder cannot be imported", async () => {
		const root = pluginsRoot();
		writeFileSync(
			join(root, SEGRA_DOCUMENTS_DIR_NAME, "tools", "index.ts"),
			"throw new Error('broken');",
		);
		const previous = process.env.SEGRA_PLUGINS_DIR;
		process.env.SEGRA_PLUGINS_DIR = root;
		const logged: string[] = [];
		try {
			await expect(
				loadDocumentTools({ log: (message) => logged.push(message) }),
			).resolves.toEqual([]);
		} finally {
			if (previous === undefined) delete process.env.SEGRA_PLUGINS_DIR;
			else process.env.SEGRA_PLUGINS_DIR = previous;
		}
		expect(logged).toContain("Failed to load built-in document tools");
	});
});
