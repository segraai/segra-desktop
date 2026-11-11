// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	APP_MODE_CHANGE_EVENT,
	APP_MODE_STORAGE_KEY,
	DEFAULT_APP_MODE,
	isAppMode,
	readStoredAppMode,
	setStoredAppMode,
	useAppMode,
	useIsAccountantMode,
} from "./app-mode";

afterEach(() => {
	window.localStorage.clear();
	vi.restoreAllMocks();
});

describe("app mode storage", () => {
	it("defaults to accountant when missing or invalid", () => {
		expect(DEFAULT_APP_MODE).toBe("accountant");
		expect(readStoredAppMode()).toBe("accountant");
		window.localStorage.setItem(APP_MODE_STORAGE_KEY, "pirate");
		expect(readStoredAppMode()).toBe("accountant");
		expect(isAppMode("developer")).toBe(true);
		expect(isAppMode("accountant")).toBe(true);
		expect(isAppMode("x")).toBe(false);
		expect(isAppMode(undefined)).toBe(false);
	});

	it("persists the mode and dispatches the change event", () => {
		const listener = vi.fn();
		window.addEventListener(APP_MODE_CHANGE_EVENT, listener);
		setStoredAppMode("developer");
		window.removeEventListener(APP_MODE_CHANGE_EVENT, listener);
		expect(window.localStorage.getItem(APP_MODE_STORAGE_KEY)).toBe("developer");
		expect(readStoredAppMode()).toBe("developer");
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("survives storage that throws", () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		expect(readStoredAppMode()).toBe("accountant");
		const listener = vi.fn();
		window.addEventListener(APP_MODE_CHANGE_EVENT, listener);
		expect(() => setStoredAppMode("developer")).not.toThrow();
		window.removeEventListener(APP_MODE_CHANGE_EVENT, listener);
		expect(listener).toHaveBeenCalledTimes(1);
	});
});

describe("useAppMode", () => {
	it("tracks changes from setStoredAppMode and storage events", async () => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		const container = document.createElement("div");
		const root = createRoot(container);
		function Probe() {
			const mode = useAppMode();
			const isAccountant = useIsAccountantMode();
			return createElement("span", null, `${mode}:${isAccountant}`);
		}
		await act(async () => root.render(createElement(Probe)));
		expect(container.textContent).toBe("accountant:true");

		await act(async () => setStoredAppMode("developer"));
		expect(container.textContent).toBe("developer:false");

		await act(async () => {
			window.localStorage.setItem(APP_MODE_STORAGE_KEY, "accountant");
			window.dispatchEvent(new StorageEvent("storage"));
		});
		expect(container.textContent).toBe("accountant:true");
		await act(async () => root.unmount());
	});
});
