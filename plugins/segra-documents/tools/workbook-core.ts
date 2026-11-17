import { randomBytes } from "node:crypto";
import { access, mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

export type CellValue = string | number | boolean | null;

export interface WorkbookCell {
	ref: string;
	value?: CellValue;
	formula?: string;
	numFmt?: string;
	bold?: boolean;
	note?: string;
}

export interface WorkbookSheet {
	name: string;
	columns?: { width?: number }[];
	cells?: WorkbookCell[];
}

export interface WriteWorkbookInput {
	path: string;
	overwrite?: boolean;
	sheets: WorkbookSheet[];
}

export interface WriteWorkbookResult {
	path: string;
	sheets: { name: string; cellCount: number; formulaCount: number }[];
	bytes: number;
}

const REF_RE = /^[A-Za-z]{1,3}[1-9][0-9]*$/;
const BAD_SHEET_CHARS = /[\\/?*[\]:]/;
const ISO_DATE_RE =
	/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z?)?$/;

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** True when a number format displays dates (contains y or d outside quotes/brackets). */
export function isDateFormat(fmt: string): boolean {
	const stripped = fmt
		.replace(/"[^"]*"/g, "")
		.replace(/\[[^\]]*\]/g, "")
		.replace(/\\./g, "");
	return /[yd]/i.test(stripped);
}

function parseIsoDate(s: string): Date | null {
	const m = ISO_DATE_RE.exec(s.trim());
	if (!m) return null;
	const [, y, mo, d, h = "0", mi = "0", sec = "0"] = m;
	const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec));
	if (
		Number.isNaN(date.getTime()) ||
		date.getUTCFullYear() !== +y ||
		date.getUTCMonth() !== +mo - 1 ||
		date.getUTCDate() !== +d
	) {
		return null;
	}
	return date;
}

/** Validate untrusted input; throws Error with a clear message. */
export function validateInput(raw: unknown): Required<WriteWorkbookInput> {
	if (!isRecord(raw)) throw new Error("Input must be an object.");
	const { path, overwrite = false, sheets } = raw;
	if (typeof path !== "string" || path.length === 0) {
		throw new Error("`path` is required and must be a string.");
	}
	if (!isAbsolute(path)) {
		throw new Error(`\`path\` must be an absolute path, got "${path}".`);
	}
	if (!path.toLowerCase().endsWith(".xlsx")) {
		throw new Error(`\`path\` must end in .xlsx, got "${path}".`);
	}
	if (typeof overwrite !== "boolean") {
		throw new Error("`overwrite` must be a boolean.");
	}
	if (!Array.isArray(sheets) || sheets.length === 0) {
		throw new Error("`sheets` must be a non-empty array.");
	}
	const seen = new Set<string>();
	const outSheets: WorkbookSheet[] = [];
	sheets.forEach((s, si) => {
		const where = `sheets[${si}]`;
		if (!isRecord(s)) throw new Error(`${where} must be an object.`);
		const { name, columns, cells } = s;
		if (typeof name !== "string" || name.trim().length === 0) {
			throw new Error(`${where}.name is required.`);
		}
		if (name.length > 31) {
			throw new Error(`${where}.name "${name}" is longer than 31 characters.`);
		}
		if (
			BAD_SHEET_CHARS.test(name) ||
			name.startsWith("'") ||
			name.endsWith("'")
		) {
			throw new Error(
				`${where}.name "${name}" contains characters Excel does not allow (\\ / ? * [ ] :) or starts/ends with an apostrophe.`,
			);
		}
		const key = name.toLowerCase();
		if (seen.has(key)) throw new Error(`Duplicate sheet name "${name}".`);
		seen.add(key);

		let outColumns: { width?: number }[] | undefined;
		if (columns !== undefined) {
			if (!Array.isArray(columns))
				throw new Error(`${where}.columns must be an array.`);
			outColumns = columns.map((c, ci) => {
				if (!isRecord(c))
					throw new Error(`${where}.columns[${ci}] must be an object.`);
				if (
					c.width !== undefined &&
					(typeof c.width !== "number" || !(c.width > 0) || c.width > 255)
				) {
					throw new Error(
						`${where}.columns[${ci}].width must be a number between 0 and 255.`,
					);
				}
				return { width: c.width as number | undefined };
			});
		}
		if (cells !== undefined && !Array.isArray(cells)) {
			throw new Error(`${where}.cells must be an array.`);
		}
		const refs = new Set<string>();
		const outCells: WorkbookCell[] = (
			(cells as unknown[] | undefined) ?? []
		).map((c, ci) => {
			const cw = `${where}.cells[${ci}]`;
			if (!isRecord(c)) throw new Error(`${cw} must be an object.`);
			if (typeof c.ref !== "string" || !REF_RE.test(c.ref)) {
				throw new Error(
					`${cw}.ref must be an A1-style cell reference like "B7", got ${JSON.stringify(c.ref)}.`,
				);
			}
			const ref = c.ref.toUpperCase();
			if (refs.has(ref))
				throw new Error(
					`${cw}: cell ${ref} appears more than once in sheet "${name}".`,
				);
			refs.add(ref);
			const hasValue = c.value !== undefined;
			const hasFormula = c.formula !== undefined;
			if (hasValue && hasFormula) {
				throw new Error(
					`${cw} (${ref}) has both \`value\` and \`formula\`; give exactly one.`,
				);
			}
			if (hasValue) {
				const v = c.value;
				if (
					!(
						v === null ||
						typeof v === "string" ||
						typeof v === "boolean" ||
						(typeof v === "number" && Number.isFinite(v))
					)
				) {
					throw new Error(
						`${cw} (${ref}).value must be a string, finite number, boolean or null.`,
					);
				}
			}
			let formula: string | undefined;
			if (hasFormula) {
				if (typeof c.formula !== "string")
					throw new Error(`${cw} (${ref}).formula must be a string.`);
				formula = c.formula.trim().replace(/^=/, "").trim();
				if (formula.length === 0)
					throw new Error(`${cw} (${ref}).formula is empty.`);
			}
			if (c.numFmt !== undefined && typeof c.numFmt !== "string") {
				throw new Error(`${cw} (${ref}).numFmt must be a string.`);
			}
			if (c.bold !== undefined && typeof c.bold !== "boolean") {
				throw new Error(`${cw} (${ref}).bold must be a boolean.`);
			}
			if (c.note !== undefined && typeof c.note !== "string") {
				throw new Error(`${cw} (${ref}).note must be a string.`);
			}
			return {
				ref,
				...(hasValue ? { value: c.value as CellValue } : {}),
				...(formula !== undefined ? { formula } : {}),
				...(c.numFmt !== undefined ? { numFmt: c.numFmt as string } : {}),
				...(c.bold !== undefined ? { bold: c.bold as boolean } : {}),
				...(c.note !== undefined ? { note: c.note as string } : {}),
			};
		});
		outSheets.push({ name, columns: outColumns, cells: outCells });
	});
	return { path, overwrite, sheets: outSheets } as Required<WriteWorkbookInput>;
}

async function exists(p: string): Promise<boolean> {
	try {
		await access(p);
		return true;
	} catch {
		return false;
	}
}

export async function writeWorkbook(
	raw: unknown,
): Promise<WriteWorkbookResult> {
	const input = validateInput(raw);
	if (!input.overwrite && (await exists(input.path))) {
		throw new Error(
			`File already exists: ${input.path}. Set overwrite: true to replace it, or choose another path.`,
		);
	}

	// Heavy import stays lazy so plugin load stays fast.
	const ExcelJS =
		(await import("exceljs")).default ?? (await import("exceljs"));
	const wb = new ExcelJS.Workbook();
	wb.creator = "Segra";
	wb.created = new Date();

	const summary: WriteWorkbookResult["sheets"] = [];
	for (const sheet of input.sheets) {
		const ws = wb.addWorksheet(sheet.name);
		(sheet.columns ?? []).forEach((c, i) => {
			if (c.width !== undefined) ws.getColumn(i + 1).width = c.width;
		});
		let formulaCount = 0;
		for (const c of sheet.cells ?? []) {
			const cell = ws.getCell(c.ref);
			if (c.formula !== undefined) {
				cell.value = {
					formula: c.formula,
				} as import("exceljs").CellFormulaValue;
				formulaCount++;
			} else if (c.value !== undefined) {
				let v: CellValue | Date = c.value;
				if (typeof v === "string" && c.numFmt && isDateFormat(c.numFmt)) {
					const d = parseIsoDate(v);
					if (d) v = d;
				}
				cell.value = v;
			}
			if (c.numFmt !== undefined) cell.numFmt = c.numFmt;
			if (c.bold) cell.font = { ...(cell.font ?? {}), bold: true };
			if (c.note !== undefined) cell.note = c.note;
		}
		summary.push({
			name: sheet.name,
			cellCount: (sheet.cells ?? []).length,
			formulaCount,
		});
	}

	await mkdir(dirname(input.path), { recursive: true });
	const tmp = `${input.path}.${randomBytes(6).toString("hex")}.tmp`;
	try {
		await wb.xlsx.writeFile(tmp);
		if (!input.overwrite && (await exists(input.path))) {
			throw new Error(
				`File already exists: ${input.path}. Set overwrite: true to replace it.`,
			);
		}
		await rename(tmp, input.path);
	} catch (err) {
		await unlink(tmp).catch(() => {});
		throw err;
	}
	const { size } = await stat(input.path);
	return { path: input.path, sheets: summary, bytes: size };
}
