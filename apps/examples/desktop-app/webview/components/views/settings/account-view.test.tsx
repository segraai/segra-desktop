// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountContent } from "./account-view";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		invoke,
		subscribe: vi.fn(() => () => {}),
		subscribeTransportState: vi.fn((listener: (state: string) => void) => {
			listener("connected");
			return () => {};
		}),
	},
	openExternalUrl: vi.fn(),
}));

describe("AccountContent", () => {
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

	async function renderWith(result: Record<string, unknown>) {
		invoke.mockImplementation(async (command: string) =>
			command === "segra_account" ? result : {},
		);
		await act(async () => {
			root.render(<AccountContent onManageSegra={() => {}} />);
		});
		await act(async () => {});
	}

	it("shows the account ID, credits and plan when signed in", async () => {
		await renderWith({
			account: {
				userId: "user_123abc",
				tier: "free",
				credits: 42,
				status: "ok",
			},
			proUrl: "https://segra.ai/pro",
			signedIn: true,
		});
		const text = container.textContent ?? "";
		expect(text).toContain("user_123abc");
		expect(text).toContain("42");
		expect(text).toContain("Free");
		expect(text).toContain("Try Pro");
	});

	it("offers sign-in when signed out", async () => {
		await renderWith({ account: null, signedIn: false });
		expect(container.textContent).toContain("Sign in to Segra");
	});

	it("says when Segra can't be reached while signed in", async () => {
		await renderWith({ account: null, signedIn: true });
		expect(container.textContent).toContain("couldn't be reached");
	});
});
