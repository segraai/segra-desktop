import { describe, expect, it, vi } from "vitest";
import { createSegraFetch } from "./segra";

const BASE = "https://segra.test/api/app/v1";
const KEY = "sk-segra-test";

function sse(chunks: unknown[]): Response {
	const body = `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`;
	return new Response(body, {
		status: 200,
		headers: { "content-type": "text/event-stream", "zg-res-key": "chat-1" },
	});
}

function fakeServer(options: { providerStatus?: number[] } = {}) {
	const providerStatus = [...(options.providerStatus ?? [])];
	let minted = 0;
	const calls: { url: string; auth: string | null; body: string }[] = [];
	const fetchImpl = vi.fn(
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const headers = new Headers(init?.headers);
			const body = typeof init?.body === "string" ? init.body : "";
			calls.push({ url, auth: headers.get("authorization"), body });
			if (url === `${BASE}/session`) {
				minted += 1;
				return Response.json({
					provider: "0xprovider",
					endpoint: "https://provider.test/v1/proxy",
					model: JSON.parse(body).model,
					token: `token-${minted}`,
					expiresAt: Date.now() + 15 * 60_000,
				});
			}
			if (url === `${BASE}/usage`) return new Response(null, { status: 204 });
			if (url.startsWith("https://provider.test/")) {
				const status = providerStatus.shift() ?? 200;
				if (status !== 200) return new Response("unauthorized", { status });
				return sse([
					{ choices: [{ delta: { content: "hi" } }] },
					{ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } },
				]);
			}
			return new Response("not found", { status: 404 });
		},
	);
	return { fetchImpl, calls, minted: () => minted };
}

const chat = (fetchFn: typeof fetch, model: string, key = KEY) =>
	fetchFn(`${BASE}/chat/completions`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${key}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ model, stream: true, messages: [] }),
	});

describe("createSegraFetch", () => {
	it("sends model calls to the minted provider endpoint with the provider token", async () => {
		const server = fakeServer();
		const segraFetch = createSegraFetch(server.fetchImpl as never, BASE);
		const response = await chat(segraFetch, "glm-5", "sk-segra-a");
		expect(await response.text()).toContain('"hi"');

		const providerCall = server.calls.find((c) =>
			c.url.startsWith("https://provider.test/"),
		);
		expect(providerCall?.url).toBe(
			"https://provider.test/v1/proxy/chat/completions",
		);
		expect(providerCall?.auth).toBe("Bearer token-1");
		// The Segra key only ever goes to the Segra server.
		for (const call of server.calls) {
			if (call.auth === "Bearer sk-segra-a")
				expect(call.url.startsWith(BASE)).toBe(true);
		}
	});

	it("reuses a session per model and reports token counts only", async () => {
		const server = fakeServer();
		const segraFetch = createSegraFetch(server.fetchImpl as never, BASE);
		await (await chat(segraFetch, "glm-5", "sk-segra-b")).text();
		await (await chat(segraFetch, "glm-5", "sk-segra-b")).text();
		await vi.waitFor(() =>
			expect(
				server.calls.filter((c) => c.url === `${BASE}/usage`),
			).toHaveLength(2),
		);
		expect(server.minted()).toBe(1);
		const report = JSON.parse(
			server.calls.find((c) => c.url === `${BASE}/usage`)!.body,
		);
		expect(report).toEqual({
			provider: "0xprovider",
			model: "glm-5",
			chatId: "chat-1",
			inputTokens: 12,
			outputTokens: 3,
			verification: "unavailable",
		});
	});

	it("sends the model the server picked for the default alias", async () => {
		const server = fakeServer();
		const resolving = vi.fn(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				if (String(input) === `${BASE}/session`) {
					return Response.json({
						provider: "0xprovider",
						endpoint: "https://provider.test/v1/proxy",
						model: "glm-5",
						token: "token-x",
						expiresAt: Date.now() + 15 * 60_000,
					});
				}
				return server.fetchImpl(input, init);
			},
		);
		const segraFetch = createSegraFetch(resolving as never, BASE);
		await (await chat(segraFetch, "default", "sk-segra-e")).text();
		const providerCall = server.calls.find((c) =>
			c.url.startsWith("https://provider.test/"),
		);
		expect(JSON.parse(providerCall?.body ?? "{}").model).toBe("glm-5");
	});

	it("renews the session once when the provider rejects the token", async () => {
		const server = fakeServer({ providerStatus: [401] });
		const segraFetch = createSegraFetch(server.fetchImpl as never, BASE);
		const response = await chat(segraFetch, "glm-5", "sk-segra-c");
		expect(response.status).toBe(200);
		expect(server.minted()).toBe(2);
	});

	it("turns Segra errors into OpenAI-style errors", async () => {
		const fetchImpl = vi.fn(async () =>
			Response.json({ error: "You're out of credits." }, { status: 402 }),
		);
		const segraFetch = createSegraFetch(fetchImpl as never, BASE);
		const response = await chat(segraFetch, "glm-5", "sk-segra-d");
		expect(response.status).toBe(402);
		expect(await response.json()).toEqual({
			error: {
				message: "You're out of credits.",
				type: "segra_error",
				code: 402,
			},
		});
	});

	it("asks for a key when none is configured", async () => {
		const server = fakeServer();
		const segraFetch = createSegraFetch(server.fetchImpl as never, BASE);
		const response = await chat(segraFetch, "glm-5", "");
		expect(response.status).toBe(401);
		expect(server.calls).toHaveLength(0);
	});
});
