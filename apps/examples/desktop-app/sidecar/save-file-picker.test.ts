import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	defaultSaveDirectory,
	pickSavePath,
	SavePickerUnavailableError,
	uniqueSavePath,
} from "./save-file-picker";
import type { PickerExec } from "./workspace-picker";

function execError(props: { code?: unknown; signal?: unknown }): Error {
	return Object.assign(new Error("Command failed"), props);
}

function fakeExec(outcomes: Record<string, string | Error>) {
	const calls: { command: string; args: string[] }[] = [];
	const exec: PickerExec = async (command, args) => {
		calls.push({ command, args });
		const outcome = outcomes[command] ?? execError({ code: "ENOENT" });
		if (outcome instanceof Error) throw outcome;
		return { stdout: outcome };
	};
	return { exec, calls };
}

describe("pickSavePath", () => {
	it("asks zenity on Linux, suggesting the name in Downloads", async () => {
		const { exec, calls } = fakeExec({ zenity: "/home/u/Pictures/cat.png\n" });
		await expect(pickSavePath("cat.png", exec, "linux")).resolves.toBe(
			"/home/u/Pictures/cat.png",
		);
		expect(calls[0]?.args).toContain("--save");
		expect(calls[0]?.args).toContain(
			`--filename=${join(defaultSaveDirectory(), "cat.png")}`,
		);
	});

	it("falls back to kdialog, and a cancel resolves to null", async () => {
		const { exec, calls } = fakeExec({ kdialog: execError({ code: 1 }) });
		await expect(pickSavePath("cat.png", exec, "linux")).resolves.toBeNull();
		expect(calls.map((call) => call.command)).toEqual(["zenity", "kdialog"]);
	});

	it("throws when no dialog is installed", async () => {
		const { exec } = fakeExec({});
		await expect(pickSavePath("cat.png", exec, "linux")).rejects.toBeInstanceOf(
			SavePickerUnavailableError,
		);
	});

	it("passes the name to PowerShell through the environment on Windows", async () => {
		let env: Record<string, string> | undefined;
		const path = await pickSavePath(
			'a"; rm -rf /.png',
			fakeExec({}).exec,
			"win32",
			async (_script, nextEnv) => {
				env = nextEnv;
				return { stdout: "C:\\Users\\u\\cat.png" };
			},
		);
		expect(path).toBe("C:\\Users\\u\\cat.png");
		expect(env?.SEGRA_SAVE_NAME).toBe('a"; rm -rf /.png');
	});

	it("treats an empty answer on Windows as cancel", async () => {
		await expect(
			pickSavePath("cat.png", fakeExec({}).exec, "win32", async () => ({
				stdout: "",
			})),
		).resolves.toBeNull();
	});
});

describe("uniqueSavePath", () => {
	it("numbers the name when the file already exists", () => {
		const taken = new Set([
			join("/d", "image.png"),
			join("/d", "image (2).png"),
		]);
		expect(uniqueSavePath("/d", "image.png", (path) => taken.has(path))).toBe(
			join("/d", "image (3).png"),
		);
	});
});
