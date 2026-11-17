import { afterEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	isBundledPluginSource,
	trimBundledDeps,
} from "./build-desktop-runtime";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

function touch(root: string, path: string): void {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), "x");
}

describe("bundled plugin copy", () => {
	it("leaves tests, fixtures, scripts and dev notes out of the app", () => {
		expect(isBundledPluginSource("/tools/document-core.ts")).toBe(true);
		expect(isBundledPluginSource("/data/eng.traineddata.gz")).toBe(true);
		expect(isBundledPluginSource("/tools/document.test.ts")).toBe(false);
		expect(isBundledPluginSource("/fixtures/t4-scan.pdf")).toBe(false);
		expect(isBundledPluginSource("/scripts/make-fixtures.ts")).toBe(false);
		expect(isBundledPluginSource("/node_modules/exceljs")).toBe(false);
		expect(isBundledPluginSource("/SPIKE_REPORT.md")).toBe(false);
	});

	it("trims files the tools never load", () => {
		const dest = mkdtempSync(join(tmpdir(), "segra-trim-"));
		dirs.push(dest);
		const keep = [
			"node_modules/pdfjs-dist/legacy/build/pdf.mjs",
			"node_modules/pdfjs-dist/cmaps/a.bcmap",
			"node_modules/tesseract.js-core/tesseract-core-simd-lstm.js",
			"node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm",
			"node_modules/@napi-rs/canvas-linux-x64-gnu/skia.node",
		];
		const drop = [
			"node_modules/.bin/rimraf",
			"node_modules/@types/node/index.d.ts",
			"node_modules/pdfjs-dist/build/pdf.mjs",
			"node_modules/pdfjs-dist/web/viewer.mjs",
			"node_modules/pdfjs-dist/legacy/build/pdf.mjs.map",
			"node_modules/exceljs/index.d.ts",
			"node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
			"node_modules/@napi-rs/canvas-linux-x64-musl/skia.node",
		];
		for (const path of [...keep, ...drop]) touch(dest, path);
		trimBundledDeps(dest, "x86_64-unknown-linux-gnu");
		for (const path of keep) expect(existsSync(join(dest, path))).toBe(true);
		for (const path of drop) expect(existsSync(join(dest, path))).toBe(false);
	});

	it("keeps musl canvas builds off glibc targets only", () => {
		const dest = mkdtempSync(join(tmpdir(), "segra-trim-"));
		dirs.push(dest);
		touch(dest, "node_modules/@napi-rs/canvas-linux-x64-musl/skia.node");
		trimBundledDeps(dest, "universal-apple-darwin");
		expect(
			existsSync(
				join(dest, "node_modules/@napi-rs/canvas-linux-x64-musl/skia.node"),
			),
		).toBe(true);
	});
});
