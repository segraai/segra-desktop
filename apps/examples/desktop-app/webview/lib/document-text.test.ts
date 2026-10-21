// @vitest-environment node
// Node, not jsdom: under jsdom fflate doesn't recognize the test's byte arrays,
// so fixtures would zip wrong. Only the XML parser is borrowed from jsdom.
import { strToU8, zipSync } from "fflate";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";
import { officeKind, officeToText } from "./document-text";

beforeAll(() => {
	globalThis.DOMParser = new JSDOM().window.DOMParser;
});

const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const W =
	'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function zipFile(name: string, parts: Record<string, string>): File {
	const zipped = zipSync(
		Object.fromEntries(
			Object.entries(parts).map(([path, xml]) => [path, strToU8(xml)]),
		),
	);
	return new File([zipped], name);
}

const slide = (lines: string[]) =>
	`<p:sld ${A} xmlns:p="p"><p:cSld><p:spTree>${lines
		.map((line) => `<a:p><a:r><a:t>${line}</a:t></a:r></a:p>`)
		.join("")}</p:spTree></p:cSld></p:sld>`;

describe("officeToText", () => {
	it("reads slides in order with their speaker notes", async () => {
		const file = zipFile("deck.pptx", {
			"ppt/slides/slide2.xml": slide(["Second slide"]),
			"ppt/slides/slide10.xml": slide(["Tenth slide"]),
			"ppt/slides/slide1.xml": slide(["Title", "Subtitle"]),
			"ppt/slides/_rels/slide1.xml.rels":
				'<Relationships><Relationship Id="r1" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
			"ppt/notesSlides/notesSlide1.xml": slide(["Say hello", "1"]),
		});
		expect(officeKind(file)).toBe("pptx");
		const text = await officeToText(file, "pptx");
		expect(text).toContain('PowerPoint "deck.pptx"');
		expect(text).toContain("3 slides.");
		expect(text.indexOf("Second slide")).toBeLessThan(
			text.indexOf("Tenth slide"),
		);
		expect(text).toContain(
			"[Slide 1]\nTitle\nSubtitle\nSpeaker notes:\nSay hello",
		);
	});

	it("reads Word paragraphs", async () => {
		const file = zipFile("memo.docx", {
			"word/document.xml": `<w:document ${W}><w:body><w:p><w:r><w:t>Hello </w:t></w:r><w:r><w:t>world</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:body></w:document>`,
		});
		expect(await officeToText(file, "docx")).toContain("Hello world\nSecond");
	});

	it("reads Excel sheets with shared strings", async () => {
		const file = zipFile("book.xlsx", {
			"xl/workbook.xml":
				'<workbook xmlns:r="r"><sheets><sheet name="Budget" r:id="rId1"/></sheets></workbook>',
			"xl/_rels/workbook.xml.rels":
				'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
			"xl/sharedStrings.xml":
				"<sst><si><t>Item</t></si><si><t>Rent</t></si></sst>",
			"xl/worksheets/sheet1.xml":
				'<worksheet><sheetData><row><c t="s"><v>0</v></c><c><v>Amount</v></c></row><row><c t="s"><v>1</v></c><c><v>1200</v></c></row></sheetData></worksheet>',
		});
		expect(await officeToText(file, "xlsx")).toContain(
			"[Sheet: Budget]\nItem\tAmount\nRent\t1200",
		);
	});
});
