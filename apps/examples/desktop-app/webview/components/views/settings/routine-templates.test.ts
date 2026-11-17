import { describe, expect, it } from "vitest";
import {
	DOCUMENT_ROUTINE_TEMPLATES,
	defaultRoutinePromptForMode,
	ROUTINE_TEMPLATES,
	routineTemplatesForMode,
} from "./routine-templates";

const DEVELOPER_WORDS = [
	"repository",
	"commit",
	"PR",
	"pull request",
	"branch",
	"codebase",
];
const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

describe("routineTemplatesForMode", () => {
	it("returns the developer templates in developer mode", () => {
		expect(routineTemplatesForMode("developer")).toBe(ROUTINE_TEMPLATES);
		expect(ROUTINE_TEMPLATES).toHaveLength(4);
	});

	it("returns the document templates in normal mode", () => {
		expect(routineTemplatesForMode("normal")).toBe(
			DOCUMENT_ROUTINE_TEMPLATES,
		);
		expect(DOCUMENT_ROUTINE_TEMPLATES.map((t) => t.title)).toEqual([
			"Check for new documents",
			"List missing documents",
			"Watch for CRA notices",
			"Weekly folder summary",
		]);
	});
});

describe("normal mode templates", () => {
	it("have unique non-empty ids and names", () => {
		for (const key of ["id", "name"] as const) {
			const values = DOCUMENT_ROUTINE_TEMPLATES.map((t) => t[key]);
			expect(values.every((v) => v.trim().length > 0)).toBe(true);
			expect(new Set(values).size).toBe(values.length);
		}
	});

	it("have a valid schedule", () => {
		for (const t of DOCUMENT_ROUTINE_TEMPLATES) {
			expect(["daily", "weekly"]).toContain(t.scheduleType);
			expect(t.scheduleDays.length).toBeGreaterThan(0);
			for (const day of t.scheduleDays) {
				expect(DAYS).toContain(day);
			}
			const hour = Number(t.scheduleHour);
			const minute = Number(t.scheduleMinute);
			expect(Number.isInteger(hour) && hour >= 0 && hour <= 23).toBe(true);
			expect(Number.isInteger(minute) && minute >= 0 && minute <= 59).toBe(
				true,
			);
			expect(t.description.trim().length).toBeGreaterThan(0);
		}
	});

	it("have prompts that use read_document and avoid developer words", () => {
		for (const t of DOCUMENT_ROUTINE_TEMPLATES) {
			expect(t.prompt).toContain("read_document");
			for (const word of DEVELOPER_WORDS) {
				expect(t.prompt).not.toMatch(
					new RegExp(`\\b${word}`, word === "PR" ? "" : "i"),
				);
			}
		}
	});
});

describe("defaultRoutinePromptForMode", () => {
	it("keeps the developer default", () => {
		expect(defaultRoutinePromptForMode("developer")).toBe(
			"Review PRs opened yesterday and summarize issues.",
		);
	});

	it("uses a document prompt in normal mode", () => {
		expect(defaultRoutinePromptForMode("normal")).toBe(
			"List the documents added to this folder since yesterday, with the type of each.",
		);
	});
});
