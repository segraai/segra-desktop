function parseModelIdList(input: unknown): string[] {
	if (!Array.isArray(input)) return [];
	return input
		.map((item) => {
			if (typeof item === "string") return item.trim();
			if (item && typeof item === "object") {
				const entry = item as { id?: unknown; name?: unknown; model?: unknown };
				for (const value of [entry.id, entry.name, entry.model]) {
					if (typeof value === "string" && value.trim()) {
						return value.trim();
					}
				}
			}
			return "";
		})
		.filter((id) => id.length > 0);
}

export function extractModelIdsFromPayload(
	payload: unknown,
	providerId: string,
): string[] {
	const rootArray = parseModelIdList(payload);
	if (rootArray.length > 0) return rootArray;
	if (!payload || typeof payload !== "object") return [];

	const data = payload as {
		data?: unknown;
		models?: unknown;
		providers?: Record<string, unknown>;
	};

	const direct = parseModelIdList(data.data ?? data.models);
	if (direct.length > 0) return direct;

	if (
		data.models &&
		typeof data.models === "object" &&
		!Array.isArray(data.models)
	) {
		const keys = Object.keys(data.models).filter((k) => k.trim().length > 0);
		if (keys.length > 0) return keys;
	}

	const scoped = data.providers?.[providerId];
	if (scoped && typeof scoped === "object") {
		const nested = scoped as { models?: unknown };
		const list = parseModelIdList(nested.models ?? scoped);
		if (list.length > 0) return list;
	}

	return [];
}

export interface ModelSourceAuth {
	baseUrl?: string;
	apiKey?: string;
	headers?: Record<string, string>;
}

/**
 * How long a model list may take. Gateways such as OmniRoute build a large
 * catalog on the first request after a restart, which can take several seconds.
 */
export const MODEL_SOURCE_TIMEOUT_MS = 30_000;

/** Drops trailing slashes from the path: `/v1/models/` often redirects. */
function withoutTrailingSlash(url: string): string {
	try {
		const parsed = new URL(url);
		if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
			parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
			return parsed.toString();
		}
	} catch {
		// Not a parseable URL: fetch reports the problem below.
	}
	return url;
}

async function fetchModelSource(
	url: string,
	init: RequestInit,
): Promise<Response> {
	try {
		return await fetch(url, {
			...init,
			signal: AbortSignal.timeout(MODEL_SOURCE_TIMEOUT_MS),
		});
	} catch (error) {
		if (error instanceof Error && error.name === "TimeoutError") {
			throw new Error(
				`failed to fetch models from ${url}: no response within ${MODEL_SOURCE_TIMEOUT_MS / 1000} s`,
			);
		}
		throw error;
	}
}

/** The server's own reason for an error response, if it gives one. */
async function errorReason(response: Response): Promise<string | undefined> {
	let text: string;
	try {
		text = (await response.text()).trim();
	} catch {
		return undefined;
	}
	if (!text) return undefined;
	let reason = text;
	try {
		const body = JSON.parse(text) as {
			error?: unknown;
			message?: unknown;
			detail?: unknown;
		};
		const nested =
			body.error && typeof body.error === "object"
				? (body.error as { message?: unknown }).message
				: body.error;
		const candidate = [nested, body.message, body.detail].find(
			(value) => typeof value === "string" && value.trim(),
		);
		if (typeof candidate === "string") reason = candidate.trim();
	} catch {
		// Not JSON: use the text as it is.
	}
	reason = reason.replace(/\s+/g, " ");
	return reason.length > 200 ? `${reason.slice(0, 200)}…` : reason;
}

export async function fetchModelIdsFromSource(
	sourceUrl: string,
	providerId: string,
	auth: ModelSourceAuth = {},
): Promise<string[]> {
	const url = withoutTrailingSlash(sourceUrl);
	// A model source may be a third-party public catalog. Up front, only send
	// provider credentials to its own origin, and do not follow authenticated
	// redirects. A different origin gets the API key only after it rejects an
	// anonymous request (see the retry below).
	const headers = new Headers();
	let sameOrigin = false;
	try {
		sameOrigin =
			!!auth.baseUrl && new URL(url).origin === new URL(auth.baseUrl).origin;
	} catch {
		// An invalid API endpoint cannot establish trust, but should not prevent
		// an independent public catalog from loading without credentials.
	}
	if (sameOrigin) {
		if (auth.apiKey?.trim()) {
			headers.set("Authorization", `Bearer ${auth.apiKey.trim()}`);
		}
		for (const [name, value] of Object.entries(auth.headers ?? {})) {
			headers.set(name, value);
		}
	}
	let hasHeaders = false;
	headers.forEach(() => {
		hasHeaders = true;
	});
	let response = await fetchModelSource(url, {
		method: "GET",
		...(hasHeaders ? { headers, redirect: "error" as const } : {}),
	});
	// The source refused an anonymous request, so it is not a public catalog.
	// Retry once with the provider's API key before giving up: the user pointed
	// this provider at the URL, and many gateways serve their model list from a
	// different host than their API. Only the key is sent — never the extra
	// headers — and redirects stay disabled so it cannot be forwarded elsewhere.
	const apiKey = auth.apiKey?.trim();
	if (
		(response.status === 401 || response.status === 403) &&
		!hasHeaders &&
		apiKey
	) {
		await response.body?.cancel().catch(() => {});
		response = await fetchModelSource(url, {
			method: "GET",
			headers: { Authorization: `Bearer ${apiKey}` },
			redirect: "error",
		});
	}
	if (!response.ok) {
		const reason = await errorReason(response);
		throw new Error(
			`failed to fetch models from ${url}: HTTP ${response.status}${reason ? `: ${reason}` : ""}`,
		);
	}
	return extractModelIdsFromPayload(
		(await response.json()) as unknown,
		providerId,
	);
}

function trimTrailingSlash(value: string): string {
	return value.replace(/\/+$/, "");
}

export function resolveModelsSourceUrl(
	baseUrl: string | undefined,
	defaultBaseUrl: string | undefined,
	modelsSourceUrl: string | undefined,
): string | undefined {
	const source = modelsSourceUrl?.trim();
	if (!source) return undefined;
	const configuredBase = baseUrl?.trim();
	if (!configuredBase || !defaultBaseUrl?.trim()) return source;

	try {
		const sourceUrl = new URL(source);
		const defaultBase = new URL(defaultBaseUrl);
		const configured = new URL(configuredBase);
		if (sourceUrl.origin !== defaultBase.origin) return source;

		const defaultPath = trimTrailingSlash(defaultBase.pathname);
		const configuredPath = trimTrailingSlash(configured.pathname);
		if (defaultPath && sourceUrl.pathname.startsWith(`${defaultPath}/`)) {
			const suffix = sourceUrl.pathname.slice(defaultPath.length);
			configured.pathname = `${configuredPath}${suffix}`;
		} else {
			configured.pathname = sourceUrl.pathname;
		}
		configured.search = sourceUrl.search;
		configured.hash = sourceUrl.hash;
		return configured.toString();
	} catch {
		return source;
	}
}
