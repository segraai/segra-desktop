// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	isLoopbackUrl,
	ProviderPrivacyBadge,
	SegraPrivacyBadge,
	type SegraVerification,
} from "./segra-privacy-badge";

const { invoke, openExternalUrl } = vi.hoisted(() => ({
	invoke: vi.fn(),
	openExternalUrl: vi.fn(),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke, subscribe: vi.fn(() => () => {}) },
	openExternalUrl,
}));

const entry = (
	model: string,
	status: SegraVerification["status"],
): SegraVerification => ({
	status,
	chatId: "c",
	model,
	provider: "0xprovider",
	expectedSigner: "0xabc",
	recoveredSigner: "0xabc",
	requestHashMatches: true,
	responseHashMatches: status !== "failed",
	error: status === "failed" ? "hash mismatch" : undefined,
	checkedAt: 1,
});

describe("SegraPrivacyBadge", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		invoke.mockReset();
		openExternalUrl.mockReset();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	async function renderFor(model: string, entries: SegraVerification[]) {
		invoke.mockResolvedValue({ entries });
		await act(async () => {
			root.render(<SegraPrivacyBadge model={model} />);
		});
		await act(async () => {});
		return container.querySelector("button")?.getAttribute("aria-label");
	}

	it("shows the latest check for the selected model", async () => {
		const entries = [entry("glm-5.3", "failed"), entry("0GM", "verified")];
		expect(await renderFor("0GM", entries)).toBe("Privacy: Verified");
		expect(await renderFor("glm-5.3", entries)).toBe("Privacy: Not verified");
		expect(invoke).toHaveBeenCalledWith("segra_verifications");
	});

	it("links to the website's explanation of every check for this provider", async () => {
		invoke.mockImplementation(async (command: string) =>
			command === "segra_verifications"
				? {
						entries: [entry("0GM", "verified")],
						verifyUrl: "https://segra.ai/verify",
					}
				: { attestation: null },
		);
		await act(async () => {
			root.render(<SegraPrivacyBadge model="0GM" />);
		});
		await act(async () => {});
		const trigger = container.querySelector("button");
		await act(async () => {
			trigger?.click();
		});
		const link = [...document.querySelectorAll("button")].find((button) =>
			button.textContent?.startsWith("Learn how each check works"),
		);
		await act(async () => link?.click());
		expect(openExternalUrl).toHaveBeenCalledWith(
			"https://segra.ai/verify?provider=0xprovider",
		);
	});

	it("shows the provider check this computer ran", async () => {
		invoke.mockImplementation(async (command: string) =>
			command === "segra_verifications"
				? { entries: [entry("0GM", "verified")] }
				: {
						attestation: {
							trusted: false,
							verdict: "Failed: Where the model runs.",
							checkedAt: 1,
							checks: [
								{
									id: "registration",
									label: "Provider registered on 0G",
									status: "pass",
								},
								{
									id: "where-model-runs",
									label: "Where the model runs",
									status: "fail",
								},
							],
						},
					},
		);
		await act(async () => {
			root.render(<SegraPrivacyBadge model="0GM" />);
		});
		await act(async () => {});
		await act(async () => {
			container.querySelector("button")?.click();
		});
		await act(async () => {});
		expect(invoke).toHaveBeenCalledWith("segra_attestation", {
			provider: "0xprovider",
		});
		const text = document.body.textContent ?? "";
		expect(text).toContain("Provider check, on this computer");
		expect(text).toContain("Failed: Where the model runs.");
		expect(text).toContain("✗ Where the model runs");
	});

	it("explains that checks start with the first reply", async () => {
		expect(await renderFor("0GM", [])).toBe("Privacy: Private");
	});

	it("says plainly that other providers aren't private", async () => {
		await act(async () => {
			root.render(<ProviderPrivacyBadge local={false} providerName="OpenAI" />);
		});
		const trigger = container.querySelector("button");
		expect(trigger?.getAttribute("aria-label")).toBe("Privacy: Not private");
		expect(trigger?.getAttribute("title")).toContain(
			"sent to OpenAI's servers",
		);
	});

	it("shows a provider at a local address as on this computer", async () => {
		await act(async () => {
			root.render(<ProviderPrivacyBadge local providerName="Ollama" />);
		});
		expect(container.querySelector("button")?.getAttribute("aria-label")).toBe(
			"Privacy: On this computer",
		);
	});
});

describe("isLoopbackUrl", () => {
	it("recognizes addresses on this computer", () => {
		expect(isLoopbackUrl("http://localhost:11434")).toBe(true);
		expect(isLoopbackUrl("http://127.0.0.1:1234/v1")).toBe(true);
		expect(isLoopbackUrl("http://[::1]:8080")).toBe(true);
	});

	it("treats anything else as remote", () => {
		expect(isLoopbackUrl("https://api.openai.com/v1")).toBe(false);
		expect(isLoopbackUrl("http://192.168.1.20:11434")).toBe(false);
		expect(isLoopbackUrl(undefined)).toBe(false);
		expect(isLoopbackUrl("not a url")).toBe(false);
	});
});
