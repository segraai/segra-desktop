// Remote OCR for `read_document`: Segra's private TEE OCR model, for accounts
// Segra has enabled for it. Everything here is best effort. The tool falls back
// to offline OCR whenever this returns undefined, so nothing here may throw.

import {
	getPersistedProviderApiKey,
	ProviderSettingsManager,
	resolveSegraBaseUrl,
} from "@cline/core";
import { createSegraFetch } from "@cline/llms";

export type SegraOcrImage = {
	data: Buffer;
	mediaType: "image/png" | "image/jpeg";
};

export type SegraRemoteOcr = (
	image: SegraOcrImage,
	signal?: AbortSignal,
) => Promise<string | undefined>;

export type SegraOcrDeps = {
	/** The signed-in Segra key and base URL, or undefined when signed out. */
	getCredentials?: () => { apiKey: string; baseUrl: string } | undefined;
	/** Plain fetch, used for /me. */
	fetch?: typeof fetch;
	/** Fetch for model calls (sessions, attestation). Default: createSegraFetch. */
	modelFetch?: (baseUrl: string) => typeof fetch;
	now?: () => number;
	/** Per-page timeout. */
	timeoutMs?: number;
};

const ME_CACHE_MS = 60_000;
const PAGE_TIMEOUT_MS = 30_000;
const PROMPT = "<image>document parsing.";

function defaultCredentials(): { apiKey: string; baseUrl: string } | undefined {
	const settings = new ProviderSettingsManager().getProviderSettings("segra");
	const apiKey = getPersistedProviderApiKey("segra", settings);
	if (!apiKey) return undefined;
	return { apiKey, baseUrl: resolveSegraBaseUrl(settings?.baseUrl) };
}

/** Removes the model's grounding boxes and special tokens, keeping the text. */
export function cleanOcrText(raw: string): string {
	return raw
		.replace(/<\|det\|>[\s\S]*?<\|\/det\|>/g, "")
		.replace(/<\|[^|>]*\|>/g, "")
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function createSegraRemoteOcr(deps: SegraOcrDeps = {}): SegraRemoteOcr {
	const getCredentials = deps.getCredentials ?? defaultCredentials;
	const baseFetch = deps.fetch ?? fetch;
	const makeModelFetch =
		deps.modelFetch ??
		((baseUrl: string) => createSegraFetch(baseFetch, baseUrl));
	const now = deps.now ?? Date.now;
	const timeoutMs = deps.timeoutMs ?? PAGE_TIMEOUT_MS;

	let meCache:
		| { key: string; at: number; model: string | undefined }
		| undefined;
	const modelFetches = new Map<string, typeof fetch>();

	async function ocrModel(
		apiKey: string,
		baseUrl: string,
		signal: AbortSignal,
	): Promise<string | undefined> {
		const key = `${baseUrl}\n${apiKey}`;
		if (meCache && meCache.key === key && now() - meCache.at < ME_CACHE_MS) {
			return meCache.model;
		}
		const response = await baseFetch(`${baseUrl}/me`, {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal,
		});
		if (!response.ok) return undefined;
		const body = (await response.json()) as {
			ocr?: { model?: unknown; status?: unknown };
		};
		const ocr = body?.ocr;
		const model =
			ocr &&
			ocr.status === "ready" &&
			typeof ocr.model === "string" &&
			ocr.model
				? ocr.model
				: undefined;
		meCache = { key, at: now(), model };
		return model;
	}

	return async (image, signal) => {
		try {
			const credentials = getCredentials();
			if (!credentials) return undefined;
			const { apiKey, baseUrl } = credentials;
			const timeout = AbortSignal.timeout(timeoutMs);
			const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
			const model = await ocrModel(apiKey, baseUrl, combined);
			if (!model) return undefined;

			let modelFetch = modelFetches.get(baseUrl);
			if (!modelFetch) {
				modelFetch = makeModelFetch(baseUrl);
				modelFetches.set(baseUrl, modelFetch);
			}
			const response = await modelFetch(`${baseUrl}/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({
					model,
					messages: [
						{
							role: "user",
							content: [
								{
									type: "image_url",
									image_url: {
										url: `data:${image.mediaType};base64,${image.data.toString("base64")}`,
									},
								},
								{ type: "text", text: PROMPT },
							],
						},
					],
					skip_special_tokens: false,
					vllm_xargs: { ngram_size: 35, window_size: 128 },
					max_tokens: 4096,
					temperature: 0,
				}),
				signal: combined,
			});
			if (!response.ok) {
				if (
					response.status === 402 ||
					response.status === 403 ||
					response.status === 409
				) {
					meCache = undefined;
				}
				return undefined;
			}
			const body = (await response.json()) as {
				choices?: { message?: { content?: unknown } }[];
			};
			const content = body?.choices?.[0]?.message?.content;
			if (typeof content !== "string") return undefined;
			return cleanOcrText(content) || undefined;
		} catch {
			return undefined;
		}
	};
}
