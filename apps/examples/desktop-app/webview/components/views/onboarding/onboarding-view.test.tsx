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
	desktopClient: {
		invoke,
		subscribe: vi.fn(() => () => {}),
		subscribeTransportState: vi.fn(() => () => {}),
	},
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

	describe("with the local model engine", () => {
		const LOCAL_MODELS = {
			models: [
				{
					id: "qwen3.5-4b",
					name: "Qwen 3.5 4B",
					description: "Fast.",
					tier: "fast",
					bytes: 2_740_937_888,
					contextWindow: 32_768,
					minMemoryGb: 8,
					downloaded: false,
					download: null,
				},
				{
					id: "qwen3.5-9b",
					name: "Qwen 3.5 9B",
					description: "Balanced.",
					tier: "balanced",
					bytes: 5_680_522_464,
					contextWindow: 32_768,
					minMemoryGb: 16,
					downloaded: false,
					download: null,
				},
			],
			recommendedId: "qwen3.5-9b",
			memoryBytes: 32 * 1024 ** 3,
			engine: { available: true, running: false, modelId: null, baseUrl: null },
		};

		beforeEach(() => {
			const fallback = invoke.getMockImplementation();
			invoke.mockImplementation(async (command: string, args?: unknown) => {
				if (command === "local_models_list") return LOCAL_MODELS;
				if (command === "local_model_download") return { started: true };
				return fallback?.(command, args);
			});
		});

		it("leads with Segra, and offers this computer below it with its trade-off", async () => {
			await render();
			await act(async () => {
				buttonByText("Get started").click();
			});

			const options = Array.from(
				container.querySelectorAll("[data-onboarding-option]"),
			).map((option) => option.getAttribute("data-onboarding-option"));
			expect(options).toEqual(["segra", "local"]);
			const segra = container.querySelector('[data-onboarding-option="segra"]');
			expect(segra?.textContent).toContain("Recommended");
			expect(segra?.textContent).toContain("sealed, secure hardware (a TEE)");
			const local = container.querySelector('[data-onboarding-option="local"]');
			expect(local?.textContent).toContain("The most private option");
			expect(local?.textContent).toContain("Downloads Qwen 3.5 9B (5.3 GB).");
			expect(buttonByText("Sign in to Segra")).toBeDefined();
			expect(buttonByText("Use this computer")).toBeDefined();
		});

		it("starts the recommended download and opens chats on it", async () => {
			await render();
			await act(async () => {
				buttonByText("Get started").click();
			});
			await act(async () => {
				buttonByText("Use this computer").click();
			});

			expect(invoke).toHaveBeenCalledWith("local_model_download", {
				model: "qwen3.5-9b",
			});
			const selection = JSON.parse(
				Object.values(
					Object.fromEntries(
						Array.from({ length: window.localStorage.length }, (_, i) => {
							const key = window.localStorage.key(i) as string;
							return [key, window.localStorage.getItem(key)];
						}),
					),
				).find((value) => value?.includes("segra-local")) ?? "{}",
			);
			expect(selection.lastProvider).toBe("segra-local");
			expect(selection.lastModelByProvider["segra-local"]).toBe("qwen3.5-9b");
			// No history to import in this test, so it lands on the last step.
			await act(async () => {});
			expect(container.textContent).toContain("Qwen 3.5 9B is downloading.");
		});
	});

	it("completes without connecting when skipped", async () => {
		const onComplete = await render();
		await act(async () => {
			buttonByText("Get started").click();
		});
		await act(async () => {
			buttonByText("Skip").click();
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
