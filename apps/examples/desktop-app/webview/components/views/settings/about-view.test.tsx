// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AboutContent } from "./about-view";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke },
	openExternalUrl: vi.fn(),
}));
vi.mock("@/lib/changelog", () => ({
	CHANGELOG_URL_ON_GITHUB: "",
	ISSUES_URL: "",
	releaseUrl: () => "",
	fetchChangelog: () => Promise.reject(new Error("offline")),
}));
vi.mock("@/hooks/use-app-update", () => ({
	checkForUpdateNow: vi.fn(),
	restartToApplyUpdate: vi.fn(),
	useAppUpdateStatus: () => ({ state: "idle" }),
}));

const base = {
	commandName: "segra",
	linkPath: "/home/a/.local/bin/segra",
	targetPath: "/app/cline-cli",
	onPath: true,
};

describe("About command-line tool", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		invoke.mockReset();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	async function renderWith(status: Record<string, unknown>) {
		invoke.mockImplementation(async (command: string) =>
			command === "cli_install_status" ? status : {},
		);
		await act(async () => {
			root.render(<AboutContent onOpenConnectors={() => {}} />);
		});
		await act(async () => {});
	}

	const buttonLabels = () =>
		Array.from(container.querySelectorAll("button")).map((b) =>
			b.textContent?.trim(),
		);

	it("hides the section when unavailable", async () => {
		await renderWith({ ...base, state: "unavailable" });
		expect(container.textContent).not.toContain("Command-line tool");
	});

	it("offers Install, then shows usage and PATH hint after installing", async () => {
		await renderWith({ ...base, state: "not_installed" });
		expect(buttonLabels()).toContain("Install");
		invoke.mockImplementation(async () => ({
			...base,
			state: "installed",
			onPath: false,
			pathHint:
				'Add this line to ~/.zshrc, then open a new terminal: export PATH="$HOME/.local/bin:$PATH"',
		}));
		const install = Array.from(container.querySelectorAll("button")).find(
			(b) => b.textContent?.trim() === "Install",
		);
		await act(async () => install?.click());
		await act(async () => {});
		expect(invoke).toHaveBeenCalledWith("install_cli");
		const text = container.textContent ?? "";
		expect(text).toContain("segra auth --provider segra");
		expect(text).toContain('export PATH="$HOME/.local/bin:$PATH"');
		expect(buttonLabels()).toContain("Remove");
	});

	it("offers Reinstall for an outdated link", async () => {
		await renderWith({ ...base, state: "outdated_link" });
		expect(buttonLabels()).toContain("Reinstall");
	});
});
