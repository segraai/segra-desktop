/**
 * Segra (segra.ai): private chat on TEE-attested models.
 *
 * The configured API key is a Segra key (`sk-segra-…`). It never reaches a
 * model provider. Before each model call this fetch trades it for a
 * short-lived provider session (`POST {baseUrl}/session`), then sends the
 * request straight to that provider's endpoint, so prompts and code never pass
 * through Segra's server. Sessions are cached per model until shortly before
 * they expire. After each response the reply's TEE signature is checked
 * (segra-verify.ts) and the token counts and check result (never content) are
 * reported to `POST {baseUrl}/usage`.
 */

import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import {
	recordSegraVerification,
	type SegraVerificationStatus,
	sha256Hex,
	verifySegraReply,
} from "./segra-verify";

export const SEGRA_PROVIDER_ID = "segra";
// Until the Segra API is deployed, the default is a local Segra server (`npm run dev` in 0g-api).
// SEGRA_BASE_URL overrides it, e.g. for a staging server.
export const SEGRA_DEFAULT_BASE_URL =
	(typeof process !== "undefined"
		? process.env?.SEGRA_BASE_URL?.trim()
		: undefined) || "http://localhost:3000/api/app/v1";

const SESSION_RENEW_MARGIN_MS = 60_000;

interface SegraSession {
	provider: string;
	endpoint: string;
	model: string;
	token: string;
	expiresAt: number;
	/** The provider's attested signing key; older Segra servers omit it. */
	signer?: string;
}

type FetchWithOptionalPreconnect = typeof fetch & {
	preconnect?: (...args: unknown[]) => unknown;
};

const sessions = new Map<string, Promise<SegraSession>>();

class SegraSessionError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

function trimTrailingSlashes(value: string): string {
	return value.replace(/\/+$/, "");
}

function bearer(headers: Headers): string {
	const value = headers.get("authorization") ?? "";
	return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : "";
}

// OpenAI-style error body, so the AI SDK surfaces the message as-is.
function errorResponse(status: number, message: string): Response {
	return new Response(
		JSON.stringify({ error: { message, type: "segra_error", code: status } }),
		{ status, headers: { "content-type": "application/json" } },
	);
}

async function mintSession(
	baseFetch: typeof fetch,
	baseUrl: string,
	apiKey: string,
	model: string,
): Promise<SegraSession> {
	const response = await baseFetch(`${baseUrl}/session`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${apiKey}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ model }),
	});
	const body = (await response.json().catch(() => ({}))) as Partial<
		SegraSession & { error: string }
	>;
	if (body.error) {
		throw new SegraSessionError(
			body.error,
			response.ok ? 502 : response.status,
		);
	}
	if (!response.ok || !body.endpoint || !body.token) {
		// Usually a wrong Base URL: e.g. a website that answers every path with HTML.
		throw new SegraSessionError(
			`${baseUrl} is not a Segra server (HTTP ${response.status} from /session). Check the Base URL in the Segra provider settings.`,
			502,
		);
	}
	return body as SegraSession;
}

function getSession(
	baseFetch: typeof fetch,
	baseUrl: string,
	apiKey: string,
	model: string,
	renew: boolean,
): Promise<SegraSession> {
	const cacheKey = `${baseUrl}\n${apiKey}\n${model}`;
	const cached = sessions.get(cacheKey);
	if (cached && !renew) {
		return cached.then((session) =>
			session.expiresAt - SESSION_RENEW_MARGIN_MS > Date.now()
				? session
				: getSession(baseFetch, baseUrl, apiKey, model, true),
		);
	}
	const pending = mintSession(baseFetch, baseUrl, apiKey, model);
	sessions.set(cacheKey, pending);
	pending.catch(() => {
		if (sessions.get(cacheKey) === pending) sessions.delete(cacheKey);
	});
	return pending;
}

interface Usage {
	inputTokens: number;
	outputTokens: number;
}

function readUsage(payload: unknown): Usage | undefined {
	const usage = (payload as { usage?: Record<string, unknown> } | null)?.usage;
	if (!usage || typeof usage !== "object") return undefined;
	const input = usage.prompt_tokens;
	const output = usage.completion_tokens;
	if (typeof input !== "number" && typeof output !== "number") return undefined;
	return {
		inputTokens: typeof input === "number" ? input : 0,
		outputTokens: typeof output === "number" ? output : 0,
	};
}

// Finds the final usage in an SSE stream (`stream_options.include_usage`) or a
// JSON body, and hashes the raw bytes for the signature check.
async function collectUsage(
	body: ReadableStream<Uint8Array>,
	isStream: boolean,
): Promise<{ usage: Usage | undefined; responseSha256: string }> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	const hash = sha256.create();
	let buffered = "";
	let usage: Usage | undefined;
	const scan = (line: string) => {
		const data = line.startsWith("data:") ? line.slice(5).trim() : "";
		if (!data || data === "[DONE]") return;
		try {
			usage = readUsage(JSON.parse(data)) ?? usage;
		} catch {
			// Not JSON; ignore.
		}
	};
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		hash.update(value);
		buffered += decoder.decode(value, { stream: true });
		if (!isStream) continue;
		const lines = buffered.split("\n");
		buffered = lines.pop() ?? "";
		for (const line of lines) scan(line.trim());
	}
	buffered += decoder.decode();
	const responseSha256 = bytesToHex(hash.digest());
	if (!isStream) {
		try {
			return { usage: readUsage(JSON.parse(buffered)), responseSha256 };
		} catch {
			return { usage: undefined, responseSha256 };
		}
	}
	scan(buffered.trim());
	return { usage, responseSha256 };
}

function reportUsage(
	baseFetch: typeof fetch,
	baseUrl: string,
	apiKey: string,
	session: SegraSession,
	chatId: string | null,
	usage: Usage,
	verification: SegraVerificationStatus,
): Promise<unknown> {
	return baseFetch(`${baseUrl}/usage`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${apiKey}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			provider: session.provider,
			model: session.model,
			chatId,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			verification,
		}),
	}).catch(() => undefined);
}

function withModel(body: string, model: string): string {
	try {
		return JSON.stringify({ ...(JSON.parse(body) as object), model });
	} catch {
		return body;
	}
}

function readModel(body: string): string | undefined {
	try {
		const model = (JSON.parse(body) as { model?: unknown }).model;
		return typeof model === "string" && model ? model : undefined;
	} catch {
		return undefined;
	}
}

export function createSegraFetch(
	baseFetch: typeof fetch,
	configuredBaseUrl: string | undefined,
): typeof fetch {
	const baseUrl = trimTrailingSlashes(
		configuredBaseUrl?.trim() || SEGRA_DEFAULT_BASE_URL,
	);

	const segraFetch = (async (input, init) => {
		const request = new Request(input, init);
		if (!request.url.startsWith(`${baseUrl}/`) || request.method !== "POST") {
			return baseFetch(input, init);
		}
		const body = await request.text();
		const model = readModel(body);
		const apiKey = bearer(request.headers);
		// Only model calls (JSON bodies naming a model) go to the provider.
		if (!model) {
			return baseFetch(request.url, {
				method: request.method,
				headers: request.headers,
				body,
				signal: request.signal,
			});
		}
		if (!apiKey) {
			return errorResponse(
				401,
				"Add your Segra API key in the Segra provider settings. Create one at segra.ai under API keys.",
			);
		}

		const path = request.url.slice(baseUrl.length);
		const send = async (renew: boolean) => {
			const session = await getSession(
				baseFetch,
				baseUrl,
				apiKey,
				model,
				renew,
			);
			const headers = new Headers(request.headers);
			headers.set("authorization", `Bearer ${session.token}`);
			// The server may resolve an alias ("default") to a concrete model.
			const providerBody =
				session.model && session.model !== model
					? withModel(body, session.model)
					: body;
			const response = await baseFetch(
				`${trimTrailingSlashes(session.endpoint)}${path}`,
				{ method: "POST", headers, body: providerBody, signal: request.signal },
			);
			return { session, response, sentBody: providerBody };
		};

		let sent: Awaited<ReturnType<typeof send>>;
		try {
			sent = await send(false);
			// A token can be rejected before its stated expiry; renew once.
			if (sent.response.status === 401) sent = await send(true);
		} catch (error) {
			if (error instanceof SegraSessionError) {
				return errorResponse(error.status, error.message);
			}
			throw error;
		}

		const { session, response, sentBody } = sent;
		if (!response.ok || !response.body) return response;
		const isStream = (response.headers.get("content-type") ?? "").includes(
			"text/event-stream",
		);
		const chatId = response.headers.get("zg-res-key");
		const requestSha256 = sha256Hex(sentBody);
		const [forCaller, forUsage] = response.body.tee();
		void collectUsage(forUsage, isStream)
			.then(async ({ usage, responseSha256 }) => {
				const verification = await verifySegraReply({
					fetch: baseFetch,
					endpoint: session.endpoint,
					chatId,
					model: session.model,
					provider: session.provider,
					expectedSigner: session.signer,
					requestSha256,
					responseSha256,
				});
				await recordSegraVerification(verification);
				if (usage) {
					await reportUsage(
						baseFetch,
						baseUrl,
						apiKey,
						session,
						chatId,
						usage,
						verification.status,
					);
				}
			})
			.catch(() => undefined);
		return new Response(forCaller, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	}) as typeof fetch;

	const baseWithPreconnect = baseFetch as FetchWithOptionalPreconnect;
	(segraFetch as FetchWithOptionalPreconnect).preconnect =
		typeof baseWithPreconnect.preconnect === "function"
			? baseWithPreconnect.preconnect.bind(baseFetch)
			: () => undefined;
	return segraFetch;
}
