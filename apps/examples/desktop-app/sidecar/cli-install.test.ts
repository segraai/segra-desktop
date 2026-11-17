import { describe, expect, it } from "vitest";
import {
	type CliInstallDeps,
	getCliInstallStatus,
	installCli,
	uninstallCli,
} from "./cli-install";

type Entry = { symlink: string } | "file";

function makeDeps(
	options: {
		platform?: NodeJS.Platform;
		env?: NodeJS.ProcessEnv;
		entries?: Record<string, Entry>;
		files?: Record<string, string>;
		shellPath?: string | null;
		userPath?: string | null;
	} = {},
) {
	const platform = options.platform ?? "linux";
	const entries: Record<string, Entry> = { ...options.entries };
	const files: Record<string, string> = {
		"/app/cline-cli": "bin",
		"C:\\App\\cline-cli.exe": "bin",
		...options.files,
	};
	const calls: string[][] = [];
	const deps: CliInstallDeps = {
		env: {
			CLINE_DESKTOP_CLI_PATH:
				platform === "win32" ? "C:\\App\\cline-cli.exe" : "/app/cline-cli",
			SHELL: "/bin/zsh",
			PATH: "/usr/bin",
			LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local",
			...options.env,
		},
		platform,
		homeDir: "/home/a",
		exists: (path) => path in files || path in entries,
		inspect: (path) => entries[path] ?? (path in files ? "file" : null),
		mkdirp: () => {},
		symlink: (target, path) => {
			entries[path] = { symlink: target };
		},
		remove: (path) => {
			delete entries[path];
			delete files[path];
		},
		readText: (path) => files[path] ?? null,
		writeText: (path, content) => {
			files[path] = content;
		},
		run: async (command, args) => {
			calls.push([command, ...args]);
			if (command === "powershell.exe") {
				return args.join(" ").includes("SetEnvironmentVariable")
					? ""
					: (options.userPath ?? "");
			}
			if (options.shellPath === null) return null;
			return `noise\n__SEGRA_PATH__${options.shellPath ?? "/usr/bin"}\n`;
		},
	};
	return { deps, entries, files, calls };
}

const LINK = "/home/a/.local/bin/segra";

describe("cli-install (unix)", () => {
	it("is unavailable without a bundled CLI", async () => {
		const { deps } = makeDeps({ env: { CLINE_DESKTOP_CLI_PATH: "" } });
		expect((await getCliInstallStatus(deps)).state).toBe("unavailable");
		const missing = makeDeps({ env: { CLINE_DESKTOP_CLI_PATH: "/nope" } });
		expect((await getCliInstallStatus(missing.deps)).state).toBe("unavailable");
	});

	it("is unsupported inside an AppImage", async () => {
		const { deps } = makeDeps({ env: { APPIMAGE: "/x.AppImage" } });
		const status = await getCliInstallStatus(deps);
		expect(status.state).toBe("unsupported");
		await expect(installCli(deps)).rejects.toThrow(/AppImage/);
	});

	it("installs a symlink and reports a zsh PATH hint when missing", async () => {
		const { deps, entries } = makeDeps();
		expect((await getCliInstallStatus(deps)).state).toBe("not_installed");
		const status = await installCli(deps);
		expect(entries[LINK]).toEqual({ symlink: "/app/cline-cli" });
		expect(status.state).toBe("installed");
		expect(status.onPath).toBe(false);
		expect(status.pathHint).toContain("~/.zshrc");
		expect(status.pathHint).toContain('export PATH="$HOME/.local/bin:$PATH"');
	});

	it("uses the login shell PATH and omits the hint when present", async () => {
		const { deps } = makeDeps({
			shellPath: "/usr/bin:/home/a/.local/bin",
		});
		const status = await getCliInstallStatus(deps);
		expect(status.onPath).toBe(true);
		expect(status.pathHint).toBeUndefined();
	});

	it("falls back to process PATH when the shell fails", async () => {
		const { deps } = makeDeps({
			shellPath: null,
			env: { PATH: "/usr/bin:/home/a/.local/bin/" },
		});
		expect((await getCliInstallStatus(deps)).onPath).toBe(true);
	});

	it("reports outdated_link for an older install and reinstall replaces it", async () => {
		const { deps, entries } = makeDeps({
			entries: { [LINK]: { symlink: "/old/Segra.app/cline-cli" } },
		});
		expect((await getCliInstallStatus(deps)).state).toBe("outdated_link");
		expect((await installCli(deps)).state).toBe("installed");
		expect(entries[LINK]).toEqual({ symlink: "/app/cline-cli" });
	});

	it("refuses to overwrite regular files or foreign symlinks", async () => {
		for (const entry of ["file", { symlink: "/usr/bin/other" }] as Entry[]) {
			const { deps, entries } = makeDeps({ entries: { [LINK]: entry } });
			expect((await getCliInstallStatus(deps)).state).toBe("unsupported");
			await expect(installCli(deps)).rejects.toThrow();
			expect(entries[LINK]).toEqual(entry);
		}
	});

	it("uninstalls only our link", async () => {
		const ours = makeDeps({
			entries: { [LINK]: { symlink: "/app/cline-cli" } },
		});
		expect((await uninstallCli(ours.deps)).state).toBe("not_installed");
		expect(ours.entries[LINK]).toBeUndefined();
		const foreign = makeDeps({ entries: { [LINK]: "file" } });
		await uninstallCli(foreign.deps);
		expect(foreign.entries[LINK]).toBe("file");
	});

	it("gives a fish hint", async () => {
		const { deps } = makeDeps({ env: { SHELL: "/usr/bin/fish" } });
		expect((await getCliInstallStatus(deps)).pathHint).toContain(
			"fish_add_path",
		);
	});
});

describe("cli-install (windows)", () => {
	const CMD = "C:\\Users\\a\\AppData\\Local\\Segra\\bin\\segra.cmd";
	const BIN = "C:\\Users\\a\\AppData\\Local\\Segra\\bin";

	it("writes the cmd shim and adds the user PATH once", async () => {
		const { deps, files, calls } = makeDeps({ platform: "win32" });
		const status = await installCli(deps);
		expect(files[CMD]).toContain('@"C:\\App\\cline-cli.exe" %*');
		expect(status.state).toBe("installed");
		expect(
			calls.some((c) => c.join(" ").includes("SetEnvironmentVariable('Path'")),
		).toBe(true);
	});

	it("skips the PATH edit when already present", async () => {
		const { deps, calls } = makeDeps({
			platform: "win32",
			userPath: `C:\\x;${BIN.toUpperCase()}\\`,
		});
		const status = await installCli(deps);
		expect(status.onPath).toBe(true);
		expect(
			calls.some((c) => c.join(" ").includes("SetEnvironmentVariable('Path'")),
		).toBe(false);
	});

	it("detects an outdated shim", async () => {
		const { deps } = makeDeps({
			platform: "win32",
			files: { [CMD]: '@echo off\r\n@"C:\\Old\\cline-cli.exe" %*\r\n' },
			userPath: BIN,
		});
		expect((await getCliInstallStatus(deps)).state).toBe("outdated_link");
	});
});
