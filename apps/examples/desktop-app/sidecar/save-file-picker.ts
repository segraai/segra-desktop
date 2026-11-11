import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, parse } from "node:path";
import { promisify } from "node:util";
import {
	describePickerFailure,
	isPickerCancellation,
	isPickerCommandMissing,
	type PickerExec,
} from "./workspace-picker";

const execFileAsync = promisify(execFile);

const defaultExec: PickerExec = (command, args) =>
	execFileAsync(command, args, { encoding: "utf8" });

/** Thrown when no native save dialog could be opened. */
export class SavePickerUnavailableError extends Error {}

/** Where files go when there is no dialog: ~/Downloads, else the home folder. */
export function defaultSaveDirectory(): string {
	const downloads = join(homedir(), "Downloads");
	return existsSync(downloads) ? downloads : homedir();
}

/** `name` in `directory`, or `name (2)`, `name (3)`… if that is taken. */
export function uniqueSavePath(
	directory: string,
	name: string,
	exists: (path: string) => boolean = existsSync,
): string {
	const { name: stem, ext } = parse(name);
	let candidate = join(directory, name);
	for (let index = 2; exists(candidate); index += 1) {
		candidate = join(directory, `${stem} (${index})${ext}`);
	}
	return candidate;
}

// AppleScript string literal: backslashes and quotes are the only escapes.
const appleScriptString = (value: string) =>
	`"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// The file name reaches PowerShell through an environment variable rather
// than the script text, so nothing in it can be run as code.
const WINDOWS_SAVE_DIALOG = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.SaveFileDialog
$dialog.Title = 'Save image'
$dialog.FileName = $env:SEGRA_SAVE_NAME
$dialog.InitialDirectory = $env:SEGRA_SAVE_DIR
$dialog.Filter = 'Images|*.png;*.jpg;*.jpeg;*.gif;*.webp|All files|*.*'
if ($dialog.ShowDialog() -eq 'OK') { [Console]::Out.Write($dialog.FileName) }
`;

/**
 * Asks where to save a file. Resolves to the chosen path, or null when the
 * user cancels; throws SavePickerUnavailableError when no dialog could open.
 * Async for the same reason as pickWorkspaceDirectory: the dialog blocks
 * until the user answers.
 */
export async function pickSavePath(
	suggestedName: string,
	exec: PickerExec = defaultExec,
	platform: NodeJS.Platform = process.platform,
	windowsExec?: (
		script: string,
		env: Record<string, string>,
	) => Promise<{ stdout: string }>,
): Promise<string | null> {
	const directory = defaultSaveDirectory();
	if (platform === "darwin") {
		try {
			const { stdout } = await exec("osascript", [
				"-e",
				`set theFile to choose file name with prompt "Save image" default name ${appleScriptString(suggestedName)} default location (POSIX file ${appleScriptString(directory)})`,
				"-e",
				"return POSIX path of theFile",
			]);
			return stdout.trim() || null;
		} catch (error) {
			if (isPickerCancellation(error)) return null;
			throw new SavePickerUnavailableError(
				describePickerFailure("osascript", error),
			);
		}
	}
	if (platform === "win32") {
		const run =
			windowsExec ??
			((script: string, env: Record<string, string>) =>
				execFileAsync(
					"powershell.exe",
					["-NoProfile", "-NonInteractive", "-STA", "-Command", script],
					{ encoding: "utf8", env: { ...process.env, ...env } },
				));
		try {
			const { stdout } = await run(WINDOWS_SAVE_DIALOG, {
				SEGRA_SAVE_NAME: suggestedName,
				SEGRA_SAVE_DIR: directory,
			});
			return stdout.trim() || null;
		} catch (error) {
			throw new SavePickerUnavailableError(
				describePickerFailure("powershell", error),
			);
		}
	}
	// Linux: zenity, then kdialog, as for the folder picker.
	const backends: { name: string; args: string[] }[] = [
		{
			name: "zenity",
			args: [
				"--file-selection",
				"--save",
				"--confirm-overwrite",
				"--title=Save image",
				`--filename=${join(directory, suggestedName)}`,
			],
		},
		{
			name: "kdialog",
			args: ["--getsavefilename", join(directory, suggestedName)],
		},
	];
	const failures: string[] = [];
	for (const backend of backends) {
		try {
			const { stdout } = await exec(backend.name, backend.args);
			return stdout.trim() || null;
		} catch (error) {
			if (isPickerCancellation(error)) return null;
			if (!isPickerCommandMissing(error)) {
				failures.push(describePickerFailure(backend.name, error));
			}
		}
	}
	throw new SavePickerUnavailableError(
		failures.length > 0 ? failures.join("; ") : "no save dialog found",
	);
}
