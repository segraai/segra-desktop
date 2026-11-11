import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeWorkbook } from "./workbook-core.ts";

const SOFFICE = "/usr/bin/soffice";
let dir: string;
let n = 0;
const file = (name = `t${n++}.xlsx`) => join(dir, name);

async function load(path: string) {
	const ExcelJS = (await import("exceljs")).default;
	const wb = new ExcelJS.Workbook();
	await wb.xlsx.readFile(path);
	return wb;
}

const inputs = {
	name: "Inputs",
	columns: [{ width: 30 }, { width: 14 }],
	cells: [
		{ ref: "A1", value: "Item", bold: true },
		{ ref: "B2", value: 100.5, numFmt: "#,##0.00", note: "source: inv1.pdf, page 2" },
		{ ref: "B3", value: 200 },
		{ ref: "B4", value: 50 },
		{ ref: "B5", formula: "=SUM(B2:B4)", bold: true },
	],
};

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "wb-test-"));
});
afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("writeWorkbook", () => {
	test("stores SUM as a formula and inputs as numbers", async () => {
		const p = file();
		const res = await writeWorkbook({ path: p, sheets: [inputs] });
		expect(res.sheets).toEqual([{ name: "Inputs", cellCount: 5, formulaCount: 1 }]);
		expect(res.bytes).toBeGreaterThan(0);
		const ws = (await load(p)).getWorksheet("Inputs")!;
		const b5 = ws.getCell("B5").value as { formula?: string };
		expect(b5.formula).toBe("SUM(B2:B4)");
		expect(b5).not.toHaveProperty("result");
		expect(ws.getCell("B2").value).toBe(100.5);
		expect(typeof ws.getCell("B2").value).toBe("number");
	});

	test("cross-sheet formula is preserved", async () => {
		const p = file();
		await writeWorkbook({
			path: p,
			sheets: [inputs, { name: "Tax", cells: [{ ref: "A1", formula: "Inputs!B5*0.15" }] }],
		});
		const v = (await load(p)).getWorksheet("Tax")!.getCell("A1").value as { formula?: string };
		expect(v.formula).toBe("Inputs!B5*0.15");
	});

	test("numFmt, bold, width and note survive", async () => {
		const p = file();
		await writeWorkbook({ path: p, sheets: [inputs] });
		const ws = (await load(p)).getWorksheet("Inputs")!;
		expect(ws.getCell("B2").numFmt).toBe("#,##0.00");
		expect(ws.getCell("A1").font?.bold).toBe(true);
		expect(ws.getColumn(1).width).toBe(30);
		expect(ws.getColumn(2).width).toBe(14);
		const note = ws.getCell("B2").note as { texts?: { text: string }[] } | string;
		const text = typeof note === "string" ? note : (note.texts ?? []).map((t) => t.text).join("");
		expect(text).toBe("source: inv1.pdf, page 2");
	});

	test("ISO dates become dates only with a date numFmt", async () => {
		const p = file();
		await writeWorkbook({
			path: p,
			sheets: [
				{
					name: "D",
					cells: [
						{ ref: "A1", value: "2025-03-31", numFmt: "yyyy-mm-dd" },
						{ ref: "A2", value: "2025-03-31" },
						{ ref: "A3", value: "2025-03-31", numFmt: "#,##0" },
					],
				},
			],
		});
		const ws = (await load(p)).getWorksheet("D")!;
		expect(ws.getCell("A1").value).toBeInstanceOf(Date);
		expect((ws.getCell("A1").value as Date).toISOString().slice(0, 10)).toBe("2025-03-31");
		expect(ws.getCell("A2").value).toBe("2025-03-31");
		expect(ws.getCell("A3").value).toBe("2025-03-31");
	});

	test("rejections", async () => {
		await expect(writeWorkbook({ path: "rel/x.xlsx", sheets: [inputs] })).rejects.toThrow(/absolute/);
		await expect(writeWorkbook({ path: file("x.csv"), sheets: [inputs] })).rejects.toThrow(/\.xlsx/);
		await expect(
			writeWorkbook({ path: file(), sheets: [{ name: "S", cells: [{ ref: "A1", value: 1, formula: "1+1" }] }] }),
		).rejects.toThrow(/both/);
		await expect(
			writeWorkbook({ path: file(), sheets: [{ name: "S", cells: [{ ref: "1A", value: 1 }] }] }),
		).rejects.toThrow(/ref/);
		const p = file();
		await writeWorkbook({ path: p, sheets: [inputs] });
		await expect(writeWorkbook({ path: p, sheets: [inputs] })).rejects.toThrow(/already exists/);
	});

	test("overwrite replaces the file and leaves no temp files", async () => {
		const p = file("over.xlsx");
		await writeWorkbook({ path: p, sheets: [inputs] });
		await writeWorkbook({ path: p, overwrite: true, sheets: [{ name: "New", cells: [{ ref: "A1", value: "x" }] }] });
		const wb = await load(p);
		expect(wb.worksheets.map((w) => w.name)).toEqual(["New"]);
		expect((await readdir(dir)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
	});

	test("creates missing parent folders", async () => {
		const p = join(dir, "a", "b", "c.xlsx");
		await writeWorkbook({ path: p, sheets: [inputs] });
		expect(existsSync(p)).toBe(true);
	});

	test.skipIf(!existsSync(SOFFICE))("LibreOffice computes the formulas", async () => {
		const p = file("calc.xlsx");
		await writeWorkbook({
			path: p,
			sheets: [inputs, { name: "Tax", cells: [{ ref: "A1", formula: "Inputs!B5*0.15" }] }],
		});
		const out = join(dir, "csv");
		const proc = Bun.spawn(
			[SOFFICE, "--headless", `-env:UserInstallation=file://${join(dir, "lo-profile")}`, "--convert-to", "csv", "--outdir", out, p],
			{ stdout: "pipe", stderr: "pipe" },
		);
		await proc.exited;
		const csv = await Bun.file(join(out, "calc.csv")).text();
		console.log("LibreOffice CSV (first sheet):\n" + csv);
		expect(csv.split("\n")[4]).toContain("350.5");
	}, 90000);

	test("timing: exceljs import and 5,000-row write", async () => {
		// Cold import measured in a fresh process (it is already cached in this one).
		const proc = Bun.spawn(
			[process.execPath, "-e", 'const t=performance.now();await import("exceljs");console.log((performance.now()-t).toFixed(0))'],
			{ cwd: join(import.meta.dir, ".."), stdout: "pipe" },
		);
		const importMs = Number((await new Response(proc.stdout).text()).trim());
		await proc.exited;
		const cells = [];
		for (let r = 1; r <= 5000; r++) {
			cells.push({ ref: `A${r}`, value: `Row ${r}` });
			cells.push({ ref: `B${r}`, value: r * 1.25, numFmt: "#,##0.00" });
			cells.push({ ref: `C${r}`, formula: `B${r}*2` });
		}
		cells.push({ ref: "B5001", formula: "SUM(B1:B5000)", bold: true });
		const t1 = performance.now();
		await writeWorkbook({ path: file("big.xlsx"), sheets: [{ name: "Big", cells }] });
		const writeMs = performance.now() - t1;
		console.log(`TIMING exceljs import: ${importMs.toFixed(0)} ms; 5,000-row write (15,001 cells): ${writeMs.toFixed(0)} ms`);
		expect(writeMs).toBeLessThan(30000);
	});
});
