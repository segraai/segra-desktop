// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_MODE_STORAGE_KEY } from "@/lib/app-mode";
import { RoutineSchedulesContent } from "./routine-view";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke },
	isTauriAvailable: vi.fn(() => false),
	openExternalUrl: vi.fn(),
}));

let container: HTMLDivElement;
let root: Root;

class ResizeObserverStub {
	disconnect() {}
	observe() {}
	unobserve() {}
}

async function renderPage(mode: "accountant" | "developer") {
	window.localStorage.setItem(APP_MODE_STORAGE_KEY, mode);
	await act(async () => {
		root.render(<RoutineSchedulesContent />);
	});
	await act(async () => {});
}

beforeEach(() => {
	Object.assign(globalThis, {
		IS_REACT_ACT_ENVIRONMENT: true,
		ResizeObserver: ResizeObserverStub,
	});
	if (typeof window.localStorage.clear !== "function") {
		Object.defineProperty(window, "localStorage", {
			configurable: true,
			value: window.sessionStorage,
		});
	}
	window.localStorage.clear();
	invoke.mockReset();
	invoke.mockResolvedValue({
		schedules: [],
		activeExecutions: [],
		upcomingRuns: [],
		lastExecutions: [],
	});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("RoutineSchedulesContent suggestions", () => {
	it("shows the accountant cards in accountant mode", async () => {
		await renderPage("accountant");
		const text = container.textContent ?? "";
		expect(text).toContain("Check for new documents");
		expect(text).toContain("Watch for CRA notices");
		expect(text).not.toContain("Find critical bugs");
	});

	it("shows the developer cards in developer mode", async () => {
		await renderPage("developer");
		const text = container.textContent ?? "";
		expect(text).toContain("Find critical bugs");
		expect(text).toContain("Keep docs updated");
		expect(text).not.toContain("Check for new documents");
	});
});
