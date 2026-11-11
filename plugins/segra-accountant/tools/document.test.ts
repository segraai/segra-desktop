import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { MAX_PAGES_PER_CALL, readDocument } from "./document-core.ts";

const fx = (name: string) => join(import.meta.dir, "..", "fixtures", name);
const timings: Record<string, number> = {};
async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
	const t = performance.now();
	try {
		return await fn();
	} finally {
		timings[label] = Math.round(performance.now() - t);
	}
}

let tmp: string;
beforeAll(() => {
	tmp = mkdtempSync(join(tmpdir(), "document-test-"));
});
afterAll(() => {
	rmSync(tmp, { recursive: true, force: true });
	console.log("TIMINGS (ms):", JSON.stringify(timings, null, 2));
});

async function makePdf(pageCount: number): Promise<string> {
	const doc = await PDFDocument.create();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	for (let i = 1; i <= pageCount; i++) {
		doc.addPage([300, 200]).drawText(`This is the text of page number ${i}`, {
			x: 10,
			y: 100,
			size: 12,
			font,
		});
	}
	const p = join(tmp, `pages-${pageCount}.pdf`);
	writeFileSync(p, await doc.save());
	return p;
}

describe("timings", () => {
	test("first import of pdfjs", async () => {
		await timed("pdfjs first import", () =>
			import("pdfjs-dist/legacy/build/pdf.mjs"),
		);
	});
});

describe("text PDF", () => {
	test("t4-text.pdf is read from the text layer", async () => {
		const r = await timed("text extraction (t4-text.pdf)", () =>
			readDocument({ path: fx("t4-text.pdf") }),
		);
		expect(r.kind).toBe("pdf");
		expect(r.pageCount).toBe(1);
		expect(r.pages).toHaveLength(1);
		expect(r.pages[0].source).toBe("text");
		expect(r.pages[0].text).toContain("68,450.00");
		expect(r.pages[0].text).toContain("12,310.55");
		expect(r.pages[0].text).toContain("Maplewood Dental Corp");
		expect(r.notes).toEqual([]);
	});

	test("result is plain JSON", async () => {
		const r = await readDocument({ path: fx("t4-text.pdf") });
		expect(JSON.parse(JSON.stringify(r))).toEqual(r);
	});
});

describe("OCR", () => {
	test("t4-scan.png is OCRed (first call includes worker start)", async () => {
		const r = await timed("OCR first call (png, incl. worker start)", () =>
			readDocument({ path: fx("t4-scan.png") }),
		);
		console.log("OCR output (png):\n" + r.pages[0].text);
		expect(r.kind).toBe("image");
		expect(r.pages[0].source).toBe("ocr");
		expect(r.pages[0].text).toContain("68,450.00");
		expect(r.pages[0].text).toContain("Maplewood");
		expect(r.pages[0].text).toContain("12,310.55");
		expect(r.pages[0].ocrConfidence).toBeGreaterThan(70);
	});

	test("second OCR call (new worker each call)", async () => {
		const r = await timed("OCR second call (png)", () =>
			readDocument({ path: fx("t4-scan.png") }),
		);
		expect(r.pages[0].text).toContain("68,450.00");
	});

	test("t4-scan.jpg (JPEG file) is OCRed", async () => {
		const r = await readDocument({ path: fx("t4-scan.jpg") });
		expect(r.pages[0].source).toBe("ocr");
		expect(r.pages[0].text).toContain("68,450.00");
	});

	test("t4-scan.pdf (PNG image inside a PDF) is OCRed", async () => {
		const r = await timed("OCR scanned PDF (png image)", () =>
			readDocument({ path: fx("t4-scan.pdf") }),
		);
		console.log("OCR output (scan pdf):\n" + r.pages[0].text);
		expect(r.kind).toBe("pdf");
		expect(r.pageCount).toBe(1);
		expect(r.pages[0].source).toBe("ocr");
		expect(r.pages[0].text).toContain("68,450.00");
		expect(r.pages[0].text).toContain("Maplewood");
		expect(r.notes).toEqual([]);
	});

	test("t4-scan-jpeg.pdf (JPEG/DCT image inside a PDF) is OCRed", async () => {
		const r = await readDocument({ path: fx("t4-scan-jpeg.pdf") });
		expect(r.pages[0].source).toBe("ocr");
		expect(r.pages[0].text).toContain("68,450.00");
		expect(r.pages[0].text).toContain("Maplewood");
	});

	test("two-page-mixed.pdf: page 1 text, page 2 OCR", async () => {
		const r = await readDocument({ path: fx("two-page-mixed.pdf") });
		expect(r.pageCount).toBe(2);
		expect(r.pages.map((p) => p.source)).toEqual(["text", "ocr"]);
		expect(r.pages[0].text).toContain("68,450.00");
		expect(r.pages[1].text).toContain("68,450.00");
		expect(r.pages[1].text).toContain("Maplewood");
	});
});

describe("page ranges", () => {
	test("pages range is 1-based and inclusive", async () => {
		const p = await makePdf(5);
		const r = await readDocument({ path: p, pages: { from: 2, to: 3 } });
		expect(r.pageCount).toBe(5);
		expect(r.pages.map((x) => x.page)).toEqual([2, 3]);
		expect(r.pages[0].text).toContain("page number 2");
		expect(r.pages[1].text).toContain("page number 3");
	});

	test("range past the end is clamped", async () => {
		const p = await makePdf(5);
		const r = await readDocument({ path: p, pages: { from: 4, to: 99 } });
		expect(r.pages.map((x) => x.page)).toEqual([4, 5]);
	});

	test("a document longer than 30 pages is capped with a note", async () => {
		const p = await makePdf(35);
		const r = await readDocument({ path: p });
		expect(r.pageCount).toBe(35);
		expect(r.pages).toHaveLength(MAX_PAGES_PER_CALL);
		expect(r.pages.at(-1)?.page).toBe(30);
		expect(r.notes.join(" ")).toMatch(/Capped at 30 pages/);
		expect(r.notes.join(" ")).toMatch(/from: 31/);
		const rest = await readDocument({ path: p, pages: { from: 31, to: 35 } });
		expect(rest.pages.map((x) => x.page)).toEqual([31, 32, 33, 34, 35]);
		expect(rest.notes).toEqual([]);
	});

	test("an explicit range over 30 pages is capped too", async () => {
		const r = await readDocument({
			path: await makePdf(35),
			pages: { from: 3, to: 35 },
		});
		expect(r.pages).toHaveLength(30);
		expect(r.pages[0].page).toBe(3);
		expect(r.notes.join(" ")).toMatch(/Capped/);
	});

	test("invalid ranges are rejected", async () => {
		const p = await makePdf(3);
		await expect(
			readDocument({ path: p, pages: { from: 0, to: 2 } }),
		).rejects.toThrow(/1-based/);
		await expect(
			readDocument({ path: p, pages: { from: 3, to: 2 } }),
		).rejects.toThrow(/1-based/);
		await expect(
			readDocument({ path: p, pages: { from: 9, to: 10 } }),
		).rejects.toThrow(/only 3 pages/);
	});
});

describe("errors", () => {
	test("missing file", async () => {
		await expect(
			readDocument({ path: join(tmp, "nope.pdf") }),
		).rejects.toThrow(/File not found/);
	});

	test("relative path", async () => {
		await expect(readDocument({ path: "fixtures/t4-text.pdf" })).rejects.toThrow(
			/absolute/,
		);
	});

	test("unsupported extension", async () => {
		const p = join(tmp, "a.docx");
		writeFileSync(p, "x");
		await expect(readDocument({ path: p })).rejects.toThrow(/Unsupported/);
	});

	test("garbage file named .pdf", async () => {
		const p = join(tmp, "garbage.pdf");
		writeFileSync(p, "this is definitely not a pdf, just some text\n".repeat(20));
		await expect(readDocument({ path: p })).rejects.toThrow(
			/not a valid PDF/,
		);
	});

	test("truncated PDF", async () => {
		const full = await Bun.file(fx("t4-text.pdf")).bytes();
		const p = join(tmp, "truncated.pdf");
		writeFileSync(p, full.subarray(0, 300));
		await expect(readDocument({ path: p })).rejects.toThrow(
			/corrupt|not a valid PDF|Could not open/,
		);
	});

	test("garbage file named .png", async () => {
		const p = join(tmp, "garbage.png");
		writeFileSync(p, "not an image at all");
		await expect(readDocument({ path: p })).rejects.toThrow(
			/not a valid PNG or JPEG/,
		);
	});

	test("password-protected PDF", async () => {
		await expect(readDocument({ path: fx("locked.pdf") })).rejects.toThrow(
			/password-protected/,
		);
	});
});

describe("offline", () => {
	test("OCR path never calls fetch in the host thread", async () => {
		const calls: string[] = [];
		const realFetch = globalThis.fetch;
		globalThis.fetch = ((input: any) => {
			calls.push(String(input?.url ?? input));
			throw new Error(`fetch is forbidden in tests: ${input}`);
		}) as typeof fetch;
		try {
			const img = await readDocument({ path: fx("t4-scan.png") });
			const pdf = await readDocument({ path: fx("t4-scan.pdf") });
			const text = await readDocument({ path: fx("t4-text.pdf") });
			expect(img.pages[0].text).toContain("68,450.00");
			expect(pdf.pages[0].text).toContain("68,450.00");
			expect(text.pages[0].text).toContain("68,450.00");
		} finally {
			globalThis.fetch = realFetch;
		}
		expect(calls).toEqual([]);
	});

	test("the OCR worker thread has fetch and sockets disabled", async () => {
		// The OCR worker runs in its own thread, where the replacement above does
		// not reach. document-ocr-worker.cjs disables the network there; prove it.
		const wrapper = join(import.meta.dir, "document-ocr-worker.cjs");
		const code = `
			const { parentPort } = require("node:worker_threads");
			require(${JSON.stringify(wrapper)});
			const out = {};
			try { fetch("http://example.invalid/"); out.fetch = "ALLOWED"; } catch (e) { out.fetch = e.message; }
			try { require("node:net").connect(80, "127.0.0.1"); out.net = "ALLOWED"; } catch (e) { out.net = e.message; }
			parentPort.postMessage(out);
		`;
		const w = new Worker(code, { eval: true });
		const out: any = await new Promise((resolve, reject) => {
			w.once("message", resolve);
			w.once("error", reject);
		});
		await w.terminate();
		expect(out.fetch).toMatch(/Network access is disabled/);
		expect(out.net).toMatch(/Network access is disabled/);
	});
});
