import { useSyncExternalStore } from "react";

export type AppMode = "normal" | "developer";

export const DEFAULT_APP_MODE: AppMode = "normal";
export const APP_MODE_STORAGE_KEY = "segra.app-mode.v1";
export const APP_MODE_CHANGE_EVENT = "segra-app-mode-change";

export function isAppMode(value: unknown): value is AppMode {
	return value === "normal" || value === "developer";
}

export function readStoredAppMode(): AppMode {
	if (typeof window === "undefined") {
		return DEFAULT_APP_MODE;
	}
	try {
		// Older builds stored "accountant" for what is now "normal"; anything
		// unrecognised falls back to the default, which is normal mode.
		const stored = window.localStorage.getItem(APP_MODE_STORAGE_KEY);
		return isAppMode(stored) ? stored : DEFAULT_APP_MODE;
	} catch {
		return DEFAULT_APP_MODE;
	}
}

export function setStoredAppMode(mode: AppMode): void {
	try {
		window.localStorage.setItem(APP_MODE_STORAGE_KEY, mode);
	} catch {
		// The change still applies for this session when persistence fails.
	}
	window.dispatchEvent(
		new CustomEvent<AppMode>(APP_MODE_CHANGE_EVENT, { detail: mode }),
	);
}

function subscribeToAppMode(onChange: () => void): () => void {
	window.addEventListener(APP_MODE_CHANGE_EVENT, onChange);
	window.addEventListener("storage", onChange);
	return () => {
		window.removeEventListener(APP_MODE_CHANGE_EVENT, onChange);
		window.removeEventListener("storage", onChange);
	};
}

function getServerAppMode(): AppMode {
	return DEFAULT_APP_MODE;
}

export function useAppMode(): AppMode {
	return useSyncExternalStore(
		subscribeToAppMode,
		readStoredAppMode,
		getServerAppMode,
	);
}

export function useIsNormalMode(): boolean {
	return useAppMode() === "normal";
}
