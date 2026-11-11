// Builds the test fixtures in ../fixtures. All data is fake.
// Uses pdf-lib, plus pdftoppm (poppler) on THIS machine only to rasterise the
// text PDF into a "scan". The plugin itself never needs poppler.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const root = join(import.meta.dir, "..");
const out = join(root, "fixtures");
mkdirSync(out, { recursive: true });

const lines: [string, number][] = [
	["T4 Statement of Remuneration Paid (SAMPLE - FAKE DATA)", 16],
	["Tax year 2025", 12],
	["Employer: Maplewood Dental Corp", 12],
	["Employee: Jordan Sample", 12],
	["SIN 000 000 000", 12],
	["Box 14  Employment income  68,450.00", 12],
	["Box 22  Income tax deducted  12,310.55", 12],
	["Box 16  Employee's CPP contributions  3,867.50", 12],
	["Box 18  Employee's EI premiums  1,049.12", 12],
];

async function textPage(doc: PDFDocument) {
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const page = doc.addPage([612, 792]);
	let y = 720;
	for (const [t, size] of lines) {
		page.drawText(t, { x: 56, y, size, font, color: rgb(0, 0, 0) });
		y -= size + 18;
	}
}

async function imagePage(doc: PDFDocument, png: Uint8Array) {
	const img = await doc.embedPng(png);
	const page = doc.addPage([612, 792]);
	const s = Math.min(612 / img.width, 792 / img.height);
	page.drawImage(img, { x: 0, y: 792 - img.height * s, width: img.width * s, height: img.height * s });
}

const textDoc = await PDFDocument.create();
await textPage(textDoc);
writeFileSync(join(out, "t4-text.pdf"), await textDoc.save());

const tmp = mkdtempSync(join(tmpdir(), "fixtures-"));
execFileSync("pdftoppm", ["-png", "-r", "150", "-singlefile", join(out, "t4-text.pdf"), join(tmp, "page")]);
const png = readFileSync(join(tmp, "page.png"));
writeFileSync(join(out, "t4-scan.png"), png);

const scanDoc = await PDFDocument.create();
await imagePage(scanDoc, png);
writeFileSync(join(out, "t4-scan.pdf"), await scanDoc.save());

// Same scan as a JPEG inside a PDF: real scanners usually produce DCT images.
execFileSync("pdftoppm", ["-jpeg", "-r", "150", "-singlefile", join(out, "t4-text.pdf"), join(tmp, "page")]);
const jpgDoc = await PDFDocument.create();
{
	const img = await jpgDoc.embedJpg(readFileSync(join(tmp, "page.jpg")));
	const page = jpgDoc.addPage([612, 792]);
	page.drawImage(img, { x: 0, y: 792 - 792, width: 612, height: 792 });
}
writeFileSync(join(out, "t4-scan-jpeg.pdf"), await jpgDoc.save());
writeFileSync(join(out, "t4-scan.jpg"), readFileSync(join(tmp, "page.jpg")));

const mixed = await PDFDocument.create();
await textPage(mixed);
await imagePage(mixed, png);
writeFileSync(join(out, "two-page-mixed.pdf"), await mixed.save());

console.log("fixtures written to", out);

// locked.pdf: encrypted with open password "test", made with LibreOffice.
const lockedTxt = join(tmp, "locked.txt");
writeFileSync(lockedTxt, "Maplewood Dental Corp sample locked document\n");
execFileSync("soffice", [
	"--headless",
	"--convert-to",
	'pdf:writer_pdf_Export:{"EncryptFile":{"type":"boolean","value":"true"},"DocumentOpenPassword":{"type":"string","value":"test"}}',
	"--outdir",
	out,
	lockedTxt,
]);
