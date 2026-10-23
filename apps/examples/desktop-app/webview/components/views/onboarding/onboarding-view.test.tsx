// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountProvider } from "@/contexts/account-context";
import type { Provider } from "@/lib/provider-schema";
import { OnboardingView } from "./onboarding-view";

const { invoke, openExternalUrl } = vi.hoisted(() => ({
	invoke: vi.fn(),
	openExternalUrl: vi.fn(),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke, subscribe: vi.fn(() => () => {}) },
	openExternalUrl,
}));

class StorageStub implements Storage {
	readonly #values = new Map<string, string>();
	get length() {
		return this.#values.size;
	}
	clear() {
		this.#values.clear();
	}
	getItem(key: string) {
		return this.#values.get(key) ?? null;
	}
	key(index: number) {
		return [...this.#values.keys()][index] ?? null;
	}
	removeItem(key: string) {
		this.#values.delete(key);
	}
	setItem(key: string, value: string) {
		this.#values.set(key, value);
	}
}

function makeProvider(overrides: Partial<Provider> = {}): Provider {
	return {
		id: "anthropic",
		name: "Anthropic",
		models: 4,
		color: "#000",
		letter: "A",
		enabled: false,
		...overrides,
	};
}

describe("OnboardingView", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		Object.defineProperty(window, "localStorage", {
			configurable: true,
			value: new StorageStub(),
		});
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		window.localStorage.clear();
		invoke.mockReset();
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_provider_catalog") {
				return {
					providers: [
						makeProvider(),
						makeProvider({ id: "openrouter", name: "OpenRouter" }),
					],
					settingsPath: "/tmp/providers.json",
				};
			}
			return {};
		});
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	function buttonByText(text: string): HTMLButtonElement {
		const button = Array.from(container.querySelectorAll("button")).find(
			(candidate) => candidate.textContent?.trim() === text,
		);
		if (!button) {
			throw new Error(`button not found: ${text}`);
		}
		return button;
	}

	async function render(onComplete = vi.fn()) {
		await act(async () => {
			root.render(
				<AccountProvider>
					<OnboardingView onComplete={onComplete} />
				</AccountProvider>,
			);
		});
		return onComplete;
	}

	it("goes straight to Segra sign-in with no other providers", async () => {
		await render();
		await act(async () => {
			buttonByText("Get started").click();
		});

		expect(container.textContent).toContain("Sign in with Segra");
		expect(container.textContent).not.toContain("Cline");
		expect(container.textContent).not.toContain("Use your own API key");
		expect(container.querySelector('[aria-label="Provider"]')).toBeNull();
		const segraOption = container.querySelector(
			'[data-onboarding-option="segra"]',
		);
		expect(
			Array.from(segraOption?.querySelectorAll("li") ?? []).map((item) =>
				item.textContent?.trim(),
			),
		).toEqual([
			"Private models running in sealed hardware (TEEs)",
			"Your code and prompts never pass through Segra",
			"Uses your Segra credits, no API keys to copy",
		]);
		expect(buttonByText("Sign in")).toBeDefined();
	});

	it("completes without connecting when skipped", async () => {
		const onComplete = await render();
		await act(async () => {
			buttonByText("Get started").click();
		});
		await act(async () => {
			buttonByText("Not now").click();
		});
		expect(onComplete).toHaveBeenCalledTimes(1);
	});

	it("lets the user cancel a pending Segra sign-in", async () => {
		await render();
		await act(async () => {
			buttonByText("Get started").click();
		});

		let rejectLogin!: (error: Error) => void;
		invoke.mockImplementation(async (command: string) => {
			if (command === "run_provider_oauth_login") {
				return await new Promise((_, reject) => {
					rejectLogin = reject;
				});
			}
			if (command === "cancel_provider_oauth_login") {
				rejectLogin(new Error("Sign-in cancelled"));
				return { cancelled: true };
			}
			return {};
		});
		await act(async () => {
			buttonByText("Sign in").click();
		});
		expect(invoke).toHaveBeenCalledWith(
			"run_provider_oauth_login",
			{ provider: "segra" },
			expect.anything(),
		);
		expect(container.textContent).toContain("Waiting for browser...");

		await act(async () => {
			buttonByText("Cancel").click();
		});
		expect(container.textContent).not.toContain("Waiting for browser...");
		expect(invoke).toHaveBeenCalledWith("cancel_provider_oauth_login", {
			provider: "segra",
		});
	});
});
