// Core logic for read_document. Must NOT import @cline/core (so Bun can test it
// directly). Heavy libraries (pdfjs-dist, tesseract.js) are imported lazily.

import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

export const MAX_PAGES_PER_CALL = 30;
/** Same threshold as the app's webview/lib/document-text.ts. */
export const MIN_PAGE_TEXT = 20;

export interface ReadDocumentInput {
	path: string;
	pages?: { from: number; to: number };
}

export interface DocumentPage {
	page: number;
	source: "text" | "ocr" | "segra-ocr" | "none";
	text: string;
	ocrConfidence?: number;
}

export interface RemoteOcrImage {
	data: Buffer;
	mediaType: "image/png" | "image/jpeg";
}

/** Optional remote OCR. Returns undefined (or throws) to fall back to tesseract. */
export type RemoteOcr = (
	image: RemoteOcrImage,
	signal?: AbortSignal,
) => Promise<string | undefined>;

export interface ReadDocumentOptions {
	remoteOcr?: RemoteOcr;
	/** For tests; defaults to Date.now. */
	now?: () => number;
}

/**
 * The tool call has 300 s (READ_DOCUMENT_TOOL timeoutMs). Remote OCR gets at
 * most 30 s per image and stops being tried after 180 s, so the rest of a long
 * scan goes to tesseract (~0.5 s a page) and the call still finishes in time.
 */
export const REMOTE_OCR_PAGE_MS = 30_000;
export const REMOTE_OCR_BUDGET_MS = 180_000;

function withRemoteOcrBudget(
	remoteOcr: RemoteOcr | undefined,
	now: () => number,
): RemoteOcr | undefined {
	if (!remoteOcr) return undefined;
	const deadline = now() + REMOTE_OCR_BUDGET_MS;
	return async (image) => {
		const left = deadline - now();
		if (left <= 0) return undefined;
		return remoteOcr(
			image,
			AbortSignal.timeout(Math.min(REMOTE_OCR_PAGE_MS, left)),
		);
	};
}

async function tryRemoteOcr(
	remoteOcr: RemoteOcr | undefined,
	images: RemoteOcrImage[],
): Promise<string | undefined> {
	if (!remoteOcr) return undefined;
	try {
		const texts: string[] = [];
		for (const image of images) {
			const text = (await remoteOcr(image))?.trim();
			if (!text) return undefined;
			texts.push(text);
		}
		return texts.join("\n").trim() || undefined;
	} catch {
		return undefined;
	}
}

export interface ReadDocumentResult {
	path: string;
	kind: "pdf" | "image";
	pageCount: number;
	pages: DocumentPage[];
	notes: string[];
}

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "data");
const ocrWorkerPath = join(here, "document-ocr-worker.cjs");
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------- OCR

interface OcrWorker {
	recognize(
		image: Uint8Array,
	): Promise<{ data: { text: string; confidence: number } }>;
	terminate(): Promise<unknown>;
}

async function startOcrWorker(): Promise<OcrWorker> {
	if (!existsSync(join(dataDir, "eng.traineddata.gz"))) {
		throw new Error(
			`OCR language data is missing (${join(dataDir, "eng.traineddata.gz")}). The plugin is not installed completely.`,
		);
	}
	const mod: any = await import("tesseract.js");
	const createWorker = mod.createWorker ?? mod.default?.createWorker;
	// OEM 1 = LSTM only. Everything is a local path: no URL means no fetch.
	const started = createWorker("eng", 1, {
		workerPath: ocrWorkerPath,
		langPath: dataDir,
		gzip: true,
		cacheMethod: "none", // do not write eng.traineddata into the cwd
		workerBlobURL: false,
		logger: () => {},
		errorHandler: () => {},
	});
	// If the worker thread dies on startup, tesseract.js never settles the promise.
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error("OCR engine did not start within 60 seconds.")),
			60_000,
		);
	});
	try {
		return await Promise.race([started, timeout]);
	} catch (e) {
		started.then((w: OcrWorker) => w.terminate()).catch(() => {});
		throw e;
	} finally {
		clearTimeout(timer);
	}
}

// ------------------------------------------------- pure JS PNG encoder

const crcTable = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

function crc32(buf: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++)
		c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
	const out = Buffer.alloc(12 + data.length);
	out.writeUInt32BE(data.length, 0);
	out.write(type, 4, "ascii");
	out.set(data, 8);
	out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
	return out;
}

/** bitDepth 1/8, colorType 0 (gray) or 2 (RGB); rows are already byte-aligned. */
export function encodePng(
	width: number,
	height: number,
	bitDepth: 1 | 8,
	colorType: 0 | 2,
	rows: Uint8Array,
	rowBytes: number,
): Buffer {
	const raw = Buffer.alloc((rowBytes + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (rowBytes + 1)] = 0; // filter: none
		raw.set(
			rows.subarray(y * rowBytes, (y + 1) * rowBytes),
			y * (rowBytes + 1) + 1,
		);
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = bitDepth;
	ihdr[9] = colorType;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", new Uint8Array(0)),
	]);
}

/** pdfjs decoded image object -> PNG bytes, or null if the layout is unknown. */
export function pdfjsImageToPng(img: {
	width: number;
	height: number;
	data?: Uint8Array | Uint8ClampedArray | null;
	kind?: number;
}): Buffer | null {
	const { width, height, data } = img;
	if (!data || !width || !height) return null;
	// pdfjs ImageKind: 1 = GRAYSCALE_1BPP, 2 = RGB_24BPP, 3 = RGBA_32BPP
	if (img.kind === 1) {
		const rowBytes = (width + 7) >> 3;
		if (data.length < rowBytes * height) return null;
		return encodePng(width, height, 1, 0, data, rowBytes);
	}
	if (img.kind === 2) {
		if (data.length < width * height * 3) return null;
		return encodePng(width, height, 8, 2, data, width * 3);
	}
	if (img.kind === 3) {
		if (data.length < width * height * 4) return null;
		const rgb = Buffer.alloc(width * height * 3);
		for (let i = 0, j = 0; i < width * height * 4; i += 4, j += 3) {
			// Flatten alpha onto white so transparent areas do not turn black.
			const a = data[i + 3] / 255;
			rgb[j] = Math.round(data[i] * a + 255 * (1 - a));
			rgb[j + 1] = Math.round(data[i + 1] * a + 255 * (1 - a));
			rgb[j + 2] = Math.round(data[i + 2] * a + 255 * (1 - a));
		}
		return encodePng(width, height, 8, 2, rgb, width * 3);
	}
	return null;
}

// -------------------------------------------------------------- pdfjs

let pdfjsPromise: Promise<any> | undefined;
function loadPdfjs(): Promise<any> {
	// Legacy build: runs on Node/Bun without DOM. With no worker file configured
	// pdfjs runs its worker code on the main thread ("fake worker"), so nothing
	// is fetched and no extra thread is needed.
	pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
	return pdfjsPromise;
}

function pdfjsAssetUrl(sub: string): string {
	const root = dirname(require.resolve("pdfjs-dist/package.json"));
	// pdfjs reads these through fs in Node, so a plain path with trailing slash.
	return `${join(root, sub)}${process.platform === "win32" ? "\\" : "/"}`;
}

async function pageImages(
	pdfjs: any,
	page: any,
): Promise<{ png: Buffer; area: number }[]> {
	const { OPS } = pdfjs;
	const ops = await page.getOperatorList();
	const found: { png: Buffer; area: number }[] = [];
	for (let i = 0; i < ops.fnArray.length; i++) {
		const fn = ops.fnArray[i];
		let img: any;
		if (fn === OPS.paintInlineImageXObject) {
			img = ops.argsArray[i][0];
		} else if (fn === OPS.paintImageXObject) {
			const name = ops.argsArray[i][0];
			img = await new Promise((resolve) => {
				const store = name.startsWith("g_") ? page.commonObjs : page.objs;
				try {
					store.get(name, resolve);
				} catch {
					resolve(null);
				}
			});
		} else {
			continue;
		}
		const png = img ? pdfjsImageToPng(img) : null;
		if (png) found.push({ png, area: img.width * img.height });
	}
	return found;
}

// --------------------------------------------------------------- main

function fail(message: string): never {
	throw new Error(message);
}

function isOcrableImage(buf: Uint8Array): boolean {
	const b = buf;
	return (
		(b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) ||
		(b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
	);
}

export async function readDocument(
	input: ReadDocumentInput,
	options: ReadDocumentOptions = {},
): Promise<ReadDocumentResult> {
	const { path } = input;
	const remoteOcr = withRemoteOcrBudget(
		options.remoteOcr,
		options.now ?? Date.now,
	);
	if (typeof path !== "string" || !isAbsolute(path))
		fail(`path must be an absolute path, got: ${JSON.stringify(path)}`);
	let st: Awaited<ReturnType<typeof stat>>;
	try {
		st = await stat(path);
	} catch {
		fail(`File not found: ${path}`);
	}
	if (!st.isFile()) fail(`Not a file: ${path}`);
	const ext = extname(path).toLowerCase();
	if (![".pdf", ".png", ".jpg", ".jpeg"].includes(ext))
		fail(
			`Unsupported file type "${ext || basename(path)}". Supported: .pdf, .png, .jpg, .jpeg.`,
		);
	const bytes = new Uint8Array(await readFile(path));
	const notes: string[] = [];

	let from = input.pages?.from;
	let to = input.pages?.to;
	if (input.pages) {
		if (
			!Number.isInteger(from) ||
			!Number.isInteger(to) ||
			(from as number) < 1 ||
			(to as number) < (from as number)
		)
			fail("pages must be 1-based integers with 1 <= from <= to.");
	}

	if (ext !== ".pdf") {
		if (!isOcrableImage(bytes))
			fail(
				`${basename(path)} is not a valid PNG or JPEG image (the file contents do not match its extension).`,
			);
		if (input.pages && (from !== 1 || to !== 1))
			notes.push("Images have a single page; the pages range was ignored.");
		const remote = await tryRemoteOcr(remoteOcr, [
			{
				data: Buffer.from(bytes),
				mediaType: bytes[0] === 0x89 ? "image/png" : "image/jpeg",
			},
		]);
		if (remote !== undefined)
			return {
				path,
				kind: "image",
				pageCount: 1,
				pages: [{ page: 1, source: "segra-ocr", text: remote }],
				notes,
			};
		const worker = await startOcrWorker();
		try {
			const { data } = await worker.recognize(bytes);
			return {
				path,
				kind: "image",
				pageCount: 1,
				pages: [
					{
						page: 1,
						source: "ocr",
						text: data.text.trim(),
						ocrConfidence: Math.round(data.confidence),
					},
				],
				notes,
			};
		} finally {
			await worker.terminate();
		}
	}

	// ---- PDF
	if (
		!(
			bytes.length > 4 && Buffer.from(bytes.subarray(0, 1024)).includes("%PDF-")
		)
	)
		fail(
			`${basename(path)} is not a valid PDF (no PDF header). It may be corrupt or not a PDF.`,
		);

	const pdfjs = await loadPdfjs();
	const task = pdfjs.getDocument({
		data: bytes,
		verbosity: 0,
		isEvalSupported: false,
		useSystemFonts: false,
		disableFontFace: true,
		isOffscreenCanvasSupported: false,
		useWorkerFetch: false,
		cMapUrl: pdfjsAssetUrl("cmaps"),
		cMapPacked: true,
		standardFontDataUrl: pdfjsAssetUrl("standard_fonts"),
		wasmUrl: pdfjsAssetUrl("wasm"),
		iccUrl: pdfjsAssetUrl("iccs"),
	});
	let doc: any;
	try {
		doc = await task.promise;
	} catch (e: any) {
		await task.destroy().catch(() => {});
		if (e?.name === "PasswordException")
			fail(
				`${basename(path)} is password-protected. Ask the user for an unlocked copy; this tool cannot open encrypted PDFs.`,
			);
		if (e?.name === "InvalidPDFException" || e?.name === "FormatError")
			fail(`${basename(path)} is corrupt or not a valid PDF (${e.message}).`);
		fail(`Could not open ${basename(path)}: ${e?.message ?? e}`);
	}

	let worker: OcrWorker | undefined;
	try {
		const pageCount: number = doc.numPages;
		from = from ?? 1;
		to = Math.min(to ?? pageCount, pageCount);
		if (from > pageCount)
			fail(
				`Page range starts at ${from} but the document has only ${pageCount} pages.`,
			);
		if (to - from + 1 > MAX_PAGES_PER_CALL) {
			const newTo = from + MAX_PAGES_PER_CALL - 1;
			notes.push(
				`Capped at ${MAX_PAGES_PER_CALL} pages per call: returned pages ${from}-${newTo} of ${pageCount}. Call again with pages: { from: ${newTo + 1}, to: ... } for the rest.`,
			);
			to = newTo;
		}

		const pages: DocumentPage[] = [];
		for (let n = from; n <= to; n++) {
			const page = await doc.getPage(n);
			const content = await page.getTextContent();
			const text = content.items
				.map((it: any) =>
					"str" in it ? it.str + (it.hasEOL ? "\n" : " ") : "",
				)
				.join("")
				.replace(/[ \t]+\n/g, "\n")
				.trim();
			if (text.length >= MIN_PAGE_TEXT) {
				pages.push({ page: n, source: "text", text });
				page.cleanup();
				continue;
			}
			const images = await pageImages(pdfjs, page);
			page.cleanup();
			if (images.length === 0) {
				if (text) pages.push({ page: n, source: "text", text });
				else {
					pages.push({ page: n, source: "none", text: "" });
					notes.push(
						`Page ${n}: no text layer and no readable embedded image (blank page, vector drawing, or an image format that could not be decoded).`,
					);
				}
				continue;
			}
			// OCR the large images (tiled scans); skip small logos/stamps.
			const biggest = Math.max(...images.map((i) => i.area));
			const chosen = images.filter((i) => i.area >= biggest * 0.25).slice(0, 6);
			const remote = await tryRemoteOcr(
				remoteOcr,
				chosen.map((i) => ({
					data: Buffer.from(i.png),
					mediaType: "image/png" as const,
				})),
			);
			if (remote !== undefined) {
				pages.push({ page: n, source: "segra-ocr", text: remote });
				continue;
			}
			worker ??= await startOcrWorker();
			const texts: string[] = [];
			let conf = 0;
			for (const im of chosen) {
				const { data } = await worker.recognize(im.png);
				texts.push(data.text.trim());
				conf += data.confidence;
			}
			pages.push({
				page: n,
				source: "ocr",
				text: texts.join("\n").trim(),
				ocrConfidence: Math.round(conf / chosen.length),
			});
		}
		return { path, kind: "pdf", pageCount, pages, notes };
	} finally {
		await worker?.terminate();
		await task.destroy().catch(() => {});
	}
}
