import { execFile } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { DESKTOP_CLI_PATH_ENV } from "./cli-runtime";

export const CLI_COMMAND_NAME = "segra";
const SHELL_PATH_TIMEOUT_MS = 5_000;

export type CliInstallState =
	| "installed"
	| "not_installed"
	| "outdated_link"
	| "unavailable"
	| "unsupported";

export interface CliInstallStatus {
	state: CliInstallState;
	commandName: string;
	linkPath: string;
	targetPath: string;
	onPath: boolean;
	pathHint?: string;
	message?: string;
}

export interface CliInstallDeps {
	env: NodeJS.ProcessEnv;
	platform: NodeJS.Platform;
	homeDir: string;
	exists(path: string): boolean;
	/** Symlink target if `path` is a symlink, "file" for anything else, null if absent. */
	inspect(path: string): { symlink: string } | "file" | null;
	mkdirp(path: string): void;
	symlink(target: string, path: string): void;
	remove(path: string): void;
	readText(path: string): string | null;
	writeText(path: string, content: string): void;
	run(
		command: string,
		args: string[],
		timeoutMs: number,
	): Promise<string | null>;
}

export function defaultCliInstallDeps(): CliInstallDeps {
	return {
		env: process.env,
		platform: process.platform,
		homeDir: homedir(),
		exists: (path) => existsSync(path),
		inspect(path) {
			try {
				const stat = lstatSync(path);
				return stat.isSymbolicLink() ? { symlink: readlinkSync(path) } : "file";
			} catch {
				return null;
			}
		},
		mkdirp: (path) => {
			mkdirSync(path, { recursive: true });
		},
		symlink: (target, path) => symlinkSync(target, path),
		remove: (path) => {
			try {
				unlinkSync(path);
			} catch {
				rmSync(path, { force: true });
			}
		},
		readText(path) {
			try {
				return readFileSync(path, "utf8");
			} catch {
				return null;
			}
		},
		writeText: (path, content) => writeFileSync(path, content),
		run: (command, args, timeoutMs) =>
			new Promise((resolvePromise) => {
				execFile(
					command,
					args,
					{ timeout: timeoutMs, windowsHide: true, encoding: "utf8" },
					(error, stdout) => resolvePromise(error ? null : String(stdout)),
				);
			}),
	};
}

function normalizeDir(dir: string, windows: boolean): string {
	let value = dir.trim().replace(/[\\/]+$/, "");
	if (windows) value = value.toLowerCase();
	return value;
}

function pathContains(
	pathValue: string | undefined | null,
	dir: string,
	deps: CliInstallDeps,
): boolean {
	if (!pathValue) return false;
	const windows = deps.platform === "win32";
	const wanted = normalizeDir(dir, windows);
	const home = deps.homeDir;
	return pathValue.split(windows ? ";" : delimiter).some((entry) => {
		let value = entry.trim();
		if (value === "~" || value.startsWith("~/")) value = home + value.slice(1);
		return normalizeDir(value, windows) === wanted;
	});
}

function unixPaths(deps: CliInstallDeps) {
	const binDir = join(deps.homeDir, ".local", "bin");
	return { binDir, linkPath: join(binDir, CLI_COMMAND_NAME) };
}

function windowsPaths(deps: CliInstallDeps) {
	const base =
		deps.env.LOCALAPPDATA?.trim() || join(deps.homeDir, "AppData", "Local");
	const binDir = `${base.replace(/[\\/]+$/, "")}\\Segra\\bin`;
	return { binDir, linkPath: `${binDir}\\${CLI_COMMAND_NAME}.cmd` };
}

export function pathHintFor(
	deps: Pick<CliInstallDeps, "env" | "platform">,
): string {
	const shell = basename(deps.env.SHELL ?? "");
	if (shell === "fish") {
		return 'Add ~/.local/bin to your PATH by running: fish_add_path "$HOME/.local/bin"';
	}
	const rc =
		shell === "zsh"
			? "~/.zshrc"
			: shell === "bash"
				? "~/.bashrc"
				: "your shell's startup file (for example ~/.profile)";
	return `Add this line to ${rc}, then open a new terminal: export PATH="$HOME/.local/bin:$PATH"`;
}

async function unixOnPath(
	binDir: string,
	deps: CliInstallDeps,
): Promise<boolean> {
	// GUI apps often get a minimal PATH; the login shell shows what terminals see.
	const shell = deps.env.SHELL?.trim();
	if (shell) {
		const out = await deps.run(
			shell,
			["-lic", 'echo "__SEGRA_PATH__$PATH"'],
			SHELL_PATH_TIMEOUT_MS,
		);
		const line = out
			?.split(/\r?\n/)
			.find((candidate) => candidate.includes("__SEGRA_PATH__"));
		if (line) {
			return pathContains(
				line.slice(line.indexOf("__SEGRA_PATH__") + "__SEGRA_PATH__".length),
				binDir,
				deps,
			);
		}
	}
	return pathContains(deps.env.PATH, binDir, deps);
}

async function windowsUserPath(deps: CliInstallDeps): Promise<string | null> {
	const out = await deps.run(
		"powershell.exe",
		[
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			"[Environment]::GetEnvironmentVariable('Path','User')",
		],
		SHELL_PATH_TIMEOUT_MS,
	);
	return out === null ? null : out.trim();
}

function isOurTargetName(target: string): boolean {
	return /^cline-cli(\.exe)?$/i.test(basename(target.replace(/\\/g, "/")));
}

function cmdContent(targetPath: string): string {
	return `@echo off\r\n@"${targetPath}" %*\r\n`;
}

function cmdTarget(content: string | null): string | null {
	const match = content?.match(/^@"([^"\r\n]+)"\s+%\*/m);
	return match?.[1] ?? null;
}

export async function getCliInstallStatus(
	deps: CliInstallDeps = defaultCliInstallDeps(),
): Promise<CliInstallStatus> {
	const windows = deps.platform === "win32";
	const { binDir, linkPath } = windows ? windowsPaths(deps) : unixPaths(deps);
	const targetPath = deps.env[DESKTOP_CLI_PATH_ENV]?.trim() ?? "";
	const base = {
		commandName: CLI_COMMAND_NAME,
		linkPath,
		targetPath,
		onPath: false,
	};

	if (deps.platform === "linux" && deps.env.APPIMAGE?.trim()) {
		return {
			...base,
			state: "unsupported",
			message:
				"The command-line tool can't be installed from an AppImage because its files only exist while the app is running. Install the .deb or .rpm package instead.",
		};
	}
	if (!targetPath || !deps.exists(targetPath)) {
		return {
			...base,
			state: "unavailable",
			message:
				"The command-line tool is only available in the installed Segra Desktop app.",
		};
	}

	if (windows) {
		const onPath = pathContains(await windowsUserPath(deps), binDir, deps);
		const withPath = { ...base, onPath };
		const hint = onPath
			? undefined
			: "Open a new terminal after installing so the updated PATH takes effect.";
		const current = cmdTarget(deps.readText(linkPath));
		if (current === null) {
			return deps.exists(linkPath)
				? {
						...withPath,
						state: "unsupported",
						message: `${linkPath} exists but wasn't created by Segra Desktop.`,
					}
				: { ...withPath, state: "not_installed" };
		}
		return {
			...withPath,
			state:
				current.toLowerCase() === targetPath.toLowerCase()
					? "installed"
					: "outdated_link",
			pathHint: hint,
		};
	}

	const onPath = await unixOnPath(binDir, deps);
	const withPath = {
		...base,
		onPath,
		pathHint: onPath ? undefined : pathHintFor(deps),
	};
	const existing = deps.inspect(linkPath);
	if (existing === null) return { ...withPath, state: "not_installed" };
	if (existing === "file") {
		return {
			...withPath,
			state: "unsupported",
			message: `${linkPath} already exists and isn't a link created by Segra Desktop, so it was left alone.`,
		};
	}
	const current = resolve(dirname(linkPath), existing.symlink);
	if (current === resolve(targetPath))
		return { ...withPath, state: "installed" };
	if (isOurTargetName(current)) return { ...withPath, state: "outdated_link" };
	return {
		...withPath,
		state: "unsupported",
		message: `${linkPath} points to ${current}, which isn't Segra Desktop, so it was left alone.`,
	};
}

export async function installCli(
	deps: CliInstallDeps = defaultCliInstallDeps(),
): Promise<CliInstallStatus> {
	const status = await getCliInstallStatus(deps);
	if (status.state === "unavailable" || status.state === "unsupported") {
		throw new Error(
			status.message ?? "The command-line tool can't be installed.",
		);
	}
	if (deps.platform === "win32") {
		const { binDir, linkPath } = windowsPaths(deps);
		deps.mkdirp(binDir);
		deps.writeText(linkPath, cmdContent(status.targetPath));
		if (!status.onPath) {
			// Edit the User Path via .NET: `setx` truncates at 1024 characters.
			const dir = binDir.replace(/'/g, "''");
			const script = `$d='${dir}';$p=[Environment]::GetEnvironmentVariable('Path','User');if(-not $p){$p=''};if(($p -split ';') -notcontains $d){$n=if($p){$p.TrimEnd(';')+';'+$d}else{$d};[Environment]::SetEnvironmentVariable('Path',$n,'User')}`;
			const out = await deps.run(
				"powershell.exe",
				["-NoProfile", "-NonInteractive", "-Command", script],
				SHELL_PATH_TIMEOUT_MS,
			);
			if (out === null) {
				throw new Error(
					`Installed ${linkPath}, but couldn't add ${binDir} to your PATH.`,
				);
			}
		}
		const after = await getCliInstallStatus(deps);
		return {
			...after,
			state: "installed",
			message: "Installed. Open a new terminal to use the segra command.",
		};
	}
	const { binDir, linkPath } = unixPaths(deps);
	deps.mkdirp(binDir);
	if (deps.inspect(linkPath) !== null) deps.remove(linkPath);
	deps.symlink(status.targetPath, linkPath);
	return { ...status, state: "installed", pathHint: status.pathHint };
}

export async function uninstallCli(
	deps: CliInstallDeps = defaultCliInstallDeps(),
): Promise<CliInstallStatus> {
	const status = await getCliInstallStatus(deps);
	if (status.state === "installed" || status.state === "outdated_link") {
		deps.remove(status.linkPath);
		return { ...status, state: "not_installed" };
	}
	return status;
}
