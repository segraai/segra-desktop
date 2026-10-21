/**
 * Segra account sign-in (OAuth 2.0 device authorization flow, RFC 8628).
 *
 * The app requests a code from the Segra server, opens the approval page in
 * the browser, and polls until the signed-in user approves. Approval yields a
 * Segra API key, stored as both the access and refresh credential: it does not
 * expire, can be revoked from the Segra web app, and only mints short-lived
 * model sessions (see @cline/llms `vendors/segra.ts`).
 */

import { hostname } from "node:os";
import { SEGRA_DEFAULT_BASE_URL } from "@cline/llms";
import type { OAuthCredentials, OAuthLoginCallbacks } from "./types";

// Segra keys never expire; revocation is detected by `refreshSegraCredentials`.
const NO_EXPIRY = Number.MAX_SAFE_INTEGER;

export interface SegraDeviceAuthorization {
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete?: string;
	expiresInSeconds: number;
	pollIntervalSeconds: number;
}

export function resolveSegraBaseUrl(baseUrl?: string): string {
	return (baseUrl?.trim() || SEGRA_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason ?? new Error("Aborted"));
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal?.reason ?? new Error("Aborted"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export async function startSegraDeviceAuth(options: {
	baseUrl?: string;
	clientName?: string;
	signal?: AbortSignal;
}): Promise<SegraDeviceAuthorization> {
	const baseUrl = resolveSegraBaseUrl(options.baseUrl);
	let response: Response;
	try {
		response = await fetch(`${baseUrl}/device/code`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ client_name: options.clientName ?? hostname() }),
			signal: options.signal,
		});
	} catch (error) {
		if (options.signal?.aborted) throw error;
		throw new Error(
			`Could not reach the Segra server at ${baseUrl}. Is it running?`,
		);
	}
	const body = (await response.json().catch(() => null)) as {
		device_code?: string;
		user_code?: string;
		verification_uri?: string;
		verification_uri_complete?: string;
		expires_in?: number;
		interval?: number;
		error?: string;
	} | null;
	if (!response.ok || !body?.device_code || !body.user_code) {
		throw new Error(
			body?.error ??
				`${baseUrl} is not a Segra server (HTTP ${response.status}). Check the Base URL in the Segra provider settings.`,
		);
	}
	return {
		deviceCode: body.device_code,
		userCode: body.user_code,
		verificationUri: body.verification_uri ?? "",
		verificationUriComplete: body.verification_uri_complete,
		expiresInSeconds: body.expires_in ?? 600,
		pollIntervalSeconds: body.interval ?? 2,
	};
}

export async function completeSegraDeviceAuth(options: {
	baseUrl?: string;
	deviceCode: string;
	expiresInSeconds: number;
	pollIntervalSeconds: number;
	signal?: AbortSignal;
}): Promise<OAuthCredentials> {
	const baseUrl = resolveSegraBaseUrl(options.baseUrl);
	const deadline = Date.now() + options.expiresInSeconds * 1000;
	let intervalMs = Math.max(1, options.pollIntervalSeconds) * 1000;
	while (Date.now() < deadline) {
		await abortableSleep(intervalMs, options.signal);
		let response: Response;
		try {
			response = await fetch(`${baseUrl}/device/token`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ device_code: options.deviceCode }),
				signal: options.signal,
			});
		} catch (error) {
			if (options.signal?.aborted) throw error;
			continue; // Transient network error: keep polling until the deadline.
		}
		const body = (await response.json().catch(() => null)) as {
			api_key?: string;
			user_id?: string;
			error?: string;
		} | null;
		if (response.ok && body?.api_key) {
			return {
				access: body.api_key,
				refresh: body.api_key,
				expires: NO_EXPIRY,
				accountId: body.user_id,
				metadata: body.user_id ? { userId: body.user_id } : undefined,
			};
		}
		switch (body?.error) {
			case "authorization_pending":
				continue;
			case "slow_down":
				intervalMs += 5000;
				continue;
			case "access_denied":
				throw new Error("Sign-in was denied in the browser.");
			case "expired_token":
				throw new Error("The sign-in code expired. Please try again.");
			default:
				throw new Error(
					`Segra sign-in failed (${body?.error ?? `HTTP ${response.status}`}).`,
				);
		}
	}
	throw new Error("The sign-in code expired. Please try again.");
}

/** Full device sign-in for hosts that only provide the generic OAuth callbacks (e.g. the CLI). */
export async function loginSegra(options: {
	baseUrl?: string;
	callbacks: OAuthLoginCallbacks;
	signal?: AbortSignal;
}): Promise<OAuthCredentials> {
	const device = await startSegraDeviceAuth(options);
	options.callbacks.onAuth({
		url: device.verificationUriComplete ?? device.verificationUri,
		instructions: `Confirm the code ${device.userCode} in your browser to sign in to Segra.`,
	});
	options.callbacks.onProgress?.(
		`Waiting for approval of code ${device.userCode}...`,
	);
	return completeSegraDeviceAuth({ ...options, ...device });
}

/**
 * Keys don't expire, so a normal refresh returns them unchanged. A forced
 * refresh (after an auth error) checks the key; a revoked key returns null,
 * which asks the user to sign in again.
 */
export async function refreshSegraCredentials(options: {
	baseUrl?: string;
	credentials: OAuthCredentials;
	forceRefresh?: boolean;
}): Promise<OAuthCredentials | null> {
	if (!options.forceRefresh) return options.credentials;
	const baseUrl = resolveSegraBaseUrl(options.baseUrl);
	try {
		const response = await fetch(`${baseUrl}/me`, {
			headers: { authorization: `Bearer ${options.credentials.access}` },
		});
		return response.status === 401 ? null : options.credentials;
	} catch {
		// Can't tell while offline; keep the key rather than signing the user out.
		return options.credentials;
	}
}
