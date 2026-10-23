// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SegraBalance } from "./segra-balance";

const { invoke, openExternalUrl } = vi.hoisted(() => ({
	invoke: vi.fn(),
	openExternalUrl: vi.fn(),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		invoke,
		subscribe: vi.fn(() => () => {}),
		subscribeTransportState: vi.fn((listener: (state: string) => void) => {
			listener("connected");
			return () => {};
		}),
	},
	openExternalUrl,
}));

describe("SegraBalance", () => {
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

	async function renderWith(account: Record<string, unknown>) {
		invoke.mockResolvedValue({
			account,
			billingUrl: "https://segra.ai/billing",
		});
		await act(async () => {
			root.render(<SegraBalance />);
		});
		await act(async () => {});
	}

	const button = (label: string) =>
		[...container.querySelectorAll("button")].find(
			(candidate) => candidate.textContent === label,
		);

	it("offers an upgrade when free credits are used up", async () => {
		await renderWith({
			billing: "wallet",
			userId: "u",
			tier: "free",
			credits: 0,
			status: "empty",
		});
		expect(container.textContent).toContain("Balance used up");
		await act(async () => button("Upgrade")?.click());
		expect(openExternalUrl).toHaveBeenCalledWith("https://segra.ai/billing");
	});

	it("offers an upgrade on a free account with credits left", async () => {
		await renderWith({
			billing: "wallet",
			userId: "u",
			tier: "free",
			credits: 120,
			status: "ok",
		});
		expect(container.textContent).toContain("120 credits left");
		expect(button("Upgrade")).toBeDefined();
	});

	it("shows only the balance on a Pro account, even when used up", async () => {
		await renderWith({
			billing: "wallet",
			userId: "u",
			tier: "paid",
			credits: 0,
			status: "empty",
		});
		expect(container.querySelector("button")).toBeNull();
	});
});
