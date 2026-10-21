/**
 * Web Search Executor
 *
 * Searches the web from this machine through DuckDuckGo's HTML endpoint: no
 * API key, no third-party search service, and no model provider involved.
 * Only the query leaves the machine, sent straight to the search engine.
 */

import type { AgentToolContext } from "@cline/shared";
import type { WebSearchExecutor } from "../types";

export interface WebSearchExecutorOptions {
	/** Search endpoint (DuckDuckGo HTML form target). */
	endpoint?: string;
	/** Maximum results returned per query. Default: 8 */
	maxResults?: number;
	/** Request timeout in milliseconds. Default: 15000 */
	timeoutMs?: number;
	userAgent?: string;
}

export interface WebSearchResult {
	title: string;
	url: string;
	snippet: string;
}

const DEFAULT_ENDPOINT = "https://html.duckduckgo.com/html/";
const DEFAULT_USER_AGENT =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

function decodeEntities(text: string): string {
	return text
		.replace(/&nbsp;/g, " ")
		.replace(/&quot;/g, '"')
		.replace(/&#x27;|&#39;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number.parseInt(n, 10)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) =>
			String.fromCharCode(Number.parseInt(n, 16)),
		)
		.replace(/&amp;/g, "&");
}

const toText = (html: string) =>
	decodeEntities(html.replace(/<[^>]+>/g, ""))
		.replace(/\s+/g, " ")
		.trim();

// Result links are usually direct; older markup wraps them in /l/?uddg=<target>.
function resolveHref(href: string): string | undefined {
	const raw = decodeEntities(href);
	try {
		const url = new URL(raw, "https://duckduckgo.com");
		const target = url.searchParams.get("uddg");
		const resolved = target ? new URL(target) : url;
		if (resolved.hostname.endsWith("duckduckgo.com")) return undefined;
		return ["http:", "https:"].includes(resolved.protocol)
			? resolved.toString()
			: undefined;
	} catch {
		return undefined;
	}
}

/** Parses DuckDuckGo's HTML results page, skipping ads. */
export function parseDuckDuckGoResults(html: string): WebSearchResult[] {
	const results: WebSearchResult[] = [];
	const blocks = html.split(/<div class="result[ "]/).slice(1);
	for (const block of blocks) {
		const classes = block.slice(0, block.indexOf('"'));
		if (classes.includes("result--ad")) continue;
		const link = block.match(
			/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/,
		);
		if (!link) continue;
		const url = resolveHref(link[1]);
		if (!url) continue;
		const snippet = block.match(
			/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/,
		);
		results.push({
			title: toText(link[2]),
			url,
			snippet: snippet ? toText(snippet[1]) : "",
		});
	}
	return results;
}

export function createWebSearchExecutor(
	options: WebSearchExecutorOptions = {},
): WebSearchExecutor {
	const {
		endpoint = DEFAULT_ENDPOINT,
		maxResults = 8,
		timeoutMs = 15000,
		userAgent = DEFAULT_USER_AGENT,
	} = options;

	return async (query: string, context: AgentToolContext): Promise<string> => {
		const trimmed = query.trim();
		if (!trimmed) throw new Error("Empty search query");

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		const onAbort = () => controller.abort();
		context.signal?.addEventListener("abort", onAbort);
		try {
			// A form POST, like DuckDuckGo's own page; plain GETs get a bot check.
			const response = await fetch(endpoint, {
				method: "POST",
				headers: {
					"User-Agent": userAgent,
					"Content-Type": "application/x-www-form-urlencoded",
					Accept: "text/html",
					"Accept-Language": "en-US,en;q=0.9",
					Referer: new URL(endpoint).origin + "/",
				},
				body: new URLSearchParams({ q: trimmed }).toString(),
				signal: controller.signal,
			});
			const html = await response.text();
			if (!response.ok || response.status === 202) {
				throw new Error(
					`Search engine returned HTTP ${response.status}${html.includes("anomaly") ? " (bot check)" : ""}. Try again shortly, or fetch a known site directly.`,
				);
			}
			const results = parseDuckDuckGoResults(html).slice(0, maxResults);
			if (results.length === 0) {
				return `No results for "${trimmed}". Try fewer or different keywords.`;
			}
			return [
				`Search results for "${trimmed}":`,
				...results.map(
					(r, i) =>
						`${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ""}`,
				),
			].join("\n");
		} catch (error) {
			if (controller.signal.aborted && !context.signal?.aborted) {
				throw new Error(`Search timed out after ${timeoutMs}ms`);
			}
			throw error;
		} finally {
			clearTimeout(timeout);
			context.signal?.removeEventListener("abort", onAbort);
		}
	};
}
