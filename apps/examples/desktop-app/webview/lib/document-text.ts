/**
 * Turns attached documents into text the model can read. Attachments are sent
 * as text, so a PDF read with `file.text()` arrives as mangled bytes (tools
 * like pdftotext then misreport it as password-protected). Extract its text
 * layer instead, and describe other binary files rather than sending them.
 */

const MAX_TEXT_CHARS = 200_000;
const MIN_PAGE_TEXT = 20;

async function loadPdfjs() {
	const pdfjs = await import("pdfjs-dist");
	pdfjs.GlobalWorkerOptions.workerSrc = new URL(
		"pdfjs-dist/build/pdf.worker.min.mjs",
		import.meta.url,
	).toString();
	return pdfjs;
}

export const isPdfFile = (file: File) =>
	file.type === "application/pdf" || /\.pdf$/i.test(file.name);

export async function pdfToText(file: File): Promise<string> {
	const pdfjs = await loadPdfjs();
	const task = pdfjs.getDocument({
		data: new Uint8Array(await file.arrayBuffer()),
	});
	const doc = await task.promise;
	const pages: string[] = [];
	let scanned = 0;
	try {
		for (let i = 1; i <= doc.numPages; i++) {
			const page = await doc.getPage(i);
			const content = await page.getTextContent();
			const text = content.items
				.map((item) =>
					"str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
				)
				.join("")
				.trim();
			if (text.length >= MIN_PAGE_TEXT) {
				pages.push(`[Page ${i}]\n${text}`);
			} else {
				scanned += 1;
				pages.push(`[Page ${i}: no text layer (scanned image), not included]`);
			}
		}
	} finally {
		await task.destroy();
	}
	let body = pages.join("\n\n");
	if (body.length > MAX_TEXT_CHARS) {
		body = `${body.slice(0, MAX_TEXT_CHARS)}\n[… truncated: the rest of the document was too long to include]`;
	}
	const note =
		scanned > 0
			? ` ${scanned} scanned page${scanned === 1 ? "" : "s"} had no text.`
			: "";
	return `Text extracted from the attached PDF "${file.name}" (${doc.numPages} pages).${note}\n\n${body}`;
}

// A NUL byte in the first 8 KB is the usual sign of a binary file.
export async function isBinaryFile(file: File): Promise<boolean> {
	const head = new Uint8Array(await file.slice(0, 8192).arrayBuffer());
	return head.includes(0);
}

// ── Office documents (.pptx, .docx, .xlsx) ────────────────────────────────
// These are ZIP archives of XML parts; pull the text out of the relevant parts.

const MAX_SHEET_ROWS = 2000;

const OFFICE_KINDS = {
	pptx: "PowerPoint",
	docx: "Word document",
	xlsx: "Excel workbook",
} as const;
type OfficeKind = keyof typeof OFFICE_KINDS;

export function officeKind(file: File): OfficeKind | null {
	const extension = file.name.split(".").pop()?.toLowerCase();
	return extension && extension in OFFICE_KINDS
		? (extension as OfficeKind)
		: null;
}

const parseXml = (xml: string) =>
	new DOMParser().parseFromString(xml, "application/xml");

const byTag = (node: Document | Element, tag: string) =>
	Array.from(node.getElementsByTagName(tag));

// Paragraphs of a DrawingML (a:p/a:t) or WordprocessingML (w:p/w:t) part.
function paragraphs(doc: Document, prefix: "a" | "w"): string[] {
	return byTag(doc, `${prefix}:p`)
		.map((p) =>
			byTag(p, `${prefix}:t`)
				.map((t) => t.textContent ?? "")
				.join(""),
		)
		.map((line) => line.trim())
		.filter(Boolean);
}

function partNumber(path: string): number {
	return Number(path.match(/(\d+)\.xml$/)?.[1] ?? 0);
}

async function unzipParts(
	file: File,
	keep: (path: string) => boolean,
): Promise<Map<string, string>> {
	const { unzipSync, strFromU8 } = await import("fflate");
	const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
		filter: (entry) => keep(entry.name),
	});
	return new Map(
		Object.entries(entries).map(([path, data]) => [path, strFromU8(data)]),
	);
}

async function pptxToText(file: File): Promise<string> {
	const parts = await unzipParts(
		file,
		(path) =>
			/^ppt\/slides\/slide\d+\.xml$/.test(path) ||
			/^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(path) ||
			/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(path),
	);
	const slides = [...parts.keys()]
		.filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
		.sort((a, b) => partNumber(a) - partNumber(b));
	const sections = slides.map((path, index) => {
		const text = paragraphs(parseXml(parts.get(path) ?? ""), "a");
		// Speaker notes are linked from the slide's relationships part.
		const rels = parts.get(
			path.replace("ppt/slides/", "ppt/slides/_rels/").concat(".rels"),
		);
		const notesTarget = rels?.match(/Target="\.\.\/notesSlides\/([^"]+)"/)?.[1];
		const notesXml = notesTarget
			? parts.get(`ppt/notesSlides/${notesTarget}`)
			: undefined;
		const notes = notesXml
			? paragraphs(parseXml(notesXml), "a").filter(
					(line) => !/^\d+$/.test(line),
				)
			: [];
		return [
			`[Slide ${index + 1}]`,
			text.length ? text.join("\n") : "(no text)",
			notes.length ? `Speaker notes:\n${notes.join("\n")}` : "",
		]
			.filter(Boolean)
			.join("\n");
	});
	return `${slides.length} slides.\n\n${sections.join("\n\n")}`;
}

async function docxToText(file: File): Promise<string> {
	const parts = await unzipParts(file, (path) => path === "word/document.xml");
	const xml = parts.get("word/document.xml");
	if (!xml) throw new Error("word/document.xml is missing");
	return paragraphs(parseXml(xml), "w").join("\n");
}

async function xlsxToText(file: File): Promise<string> {
	const parts = await unzipParts(
		file,
		(path) =>
			path === "xl/workbook.xml" ||
			path === "xl/_rels/workbook.xml.rels" ||
			path === "xl/sharedStrings.xml" ||
			/^xl\/worksheets\/sheet\d+\.xml$/.test(path),
	);
	const shared = byTag(
		parseXml(parts.get("xl/sharedStrings.xml") ?? "<sst/>"),
		"si",
	).map((si) =>
		byTag(si, "t")
			.map((t) => t.textContent ?? "")
			.join(""),
	);
	const rels = new Map(
		byTag(
			parseXml(parts.get("xl/_rels/workbook.xml.rels") ?? "<r/>"),
			"Relationship",
		).map((rel) => [rel.getAttribute("Id"), rel.getAttribute("Target") ?? ""]),
	);
	const sheets = byTag(
		parseXml(parts.get("xl/workbook.xml") ?? "<w/>"),
		"sheet",
	).map((sheet) => {
		const target = rels.get(sheet.getAttribute("r:id")) ?? "";
		return {
			name: sheet.getAttribute("name") ?? "Sheet",
			path: `xl/${target.replace(/^\/?xl\//, "")}`,
		};
	});
	const sections = sheets.map(({ name, path }) => {
		const doc = parseXml(parts.get(path) ?? "<worksheet/>");
		const rows = byTag(doc, "row");
		const lines = rows.slice(0, MAX_SHEET_ROWS).map((row) =>
			byTag(row, "c")
				.map((cell) => {
					const type = cell.getAttribute("t");
					const value = byTag(cell, "v")[0]?.textContent ?? "";
					if (type === "s") return shared[Number(value)] ?? "";
					if (type === "inlineStr")
						return byTag(cell, "t")[0]?.textContent ?? "";
					if (type === "b") return value === "1" ? "TRUE" : "FALSE";
					return value;
				})
				.join("\t"),
		);
		const more =
			rows.length > MAX_SHEET_ROWS
				? `\n[… ${rows.length - MAX_SHEET_ROWS} more rows not included]`
				: "";
		return `[Sheet: ${name}]\n${lines.join("\n")}${more}`;
	});
	return sections.join("\n\n");
}

export async function officeToText(
	file: File,
	kind: OfficeKind,
): Promise<string> {
	const extract =
		kind === "pptx" ? pptxToText : kind === "docx" ? docxToText : xlsxToText;
	let body = await extract(file);
	if (body.length > MAX_TEXT_CHARS) {
		body = `${body.slice(0, MAX_TEXT_CHARS)}\n[… truncated: the rest of the document was too long to include]`;
	}
	return `Text extracted from the attached ${OFFICE_KINDS[kind]} "${file.name}".\n\n${body}`;
}
