import { afterEach, expect, it, vi } from "vitest";
import { fetchModelIdsFromSource } from "./model-source";

afterEach(() => vi.unstubAllGlobals());

it.each([
	undefined,
	"catalog.example/v1",
	"localhost:1234",
	"/v1",
	"https://",
])("fetches public catalogs without credentials when the base URL is %s", async (baseUrl) => {
	const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
		Response.json(["public-model"]),
	);
	vi.stubGlobal("fetch", fetchMock);
	await expect(
		fetchModelIdsFromSource("https://catalog.example/models", "custom", {
			baseUrl,
			apiKey: "secret",
			headers: { "X-Secret": "secret" },
		}),
	).resolves.toEqual(["public-model"]);
	expect(fetchMock).toHaveBeenCalledOnce();
	expect([...new Headers(fetchMock.mock.calls[0][1].headers)]).toEqual([]);
});

it("honors explicit authorization headers without duplicating bearer auth", async () => {
	const fetchMock = vi.fn(
		async (_url: string, _init: RequestInit) => new Response('["agent_test"]'),
	);
	vi.stubGlobal("fetch", fetchMock);
	await fetchModelIdsFromSource("https://host.example/models", "custom", {
		baseUrl: "https://host.example/v1",
		apiKey: "key",
		headers: { authorization: "Basic custom" },
	});
	const init = fetchMock.mock.calls[0][1];
	expect([...new Headers(init.headers)]).toEqual([
		["authorization", "Basic custom"],
	]);
	expect(init.redirect).toBe("error");
});

it("does not send provider credentials to a different origin", async () => {
	const fetchMock = vi.fn(
		async (_url: string, _init: RequestInit) =>
			new Response('["public-model"]'),
	);
	vi.stubGlobal("fetch", fetchMock);
	await fetchModelIdsFromSource("https://catalog.example/models", "custom", {
		baseUrl: "https://host.example/v1",
		apiKey: "secret",
		headers: { "X-Secret": "secret" },
	});
	const init = fetchMock.mock.calls[0][1];
	expect([...new Headers(init.headers)]).toEqual([]);
});

it.each([
	401, 403,
])("retries with the API key when a different origin answers %i", async (status) => {
	const fetchMock = vi.fn(async (_url: string, init: RequestInit) =>
		new Headers(init.headers).has("authorization")
			? Response.json({ data: [{ id: "private-model" }] })
			: new Response("denied", { status }),
	);
	vi.stubGlobal("fetch", fetchMock);
	await expect(
		fetchModelIdsFromSource("https://catalog.example/models", "custom", {
			baseUrl: "https://host.example/v1",
			apiKey: " secret ",
			headers: { "X-Secret": "secret" },
		}),
	).resolves.toEqual(["private-model"]);
	expect(fetchMock).toHaveBeenCalledTimes(2);
	expect([...new Headers(fetchMock.mock.calls[0][1].headers)]).toEqual([]);
	const retry = fetchMock.mock.calls[1][1];
	expect([...new Headers(retry.headers)]).toEqual([
		["authorization", "Bearer secret"],
	]);
	expect(retry.redirect).toBe("error");
});

it("reports the denial when the API key is rejected too", async () => {
	const fetchMock = vi.fn(
		async (_url: string, _init: RequestInit) =>
			new Response("denied", { status: 401 }),
	);
	vi.stubGlobal("fetch", fetchMock);
	await expect(
		fetchModelIdsFromSource("https://catalog.example/models", "custom", {
			baseUrl: "https://host.example/v1",
			apiKey: "secret",
		}),
	).rejects.toThrow("HTTP 401");
	expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("does not retry a denial when there is no API key or it was already sent", async () => {
	const fetchMock = vi.fn(
		async (_url: string, _init: RequestInit) =>
			new Response("denied", { status: 403 }),
	);
	vi.stubGlobal("fetch", fetchMock);
	await expect(
		fetchModelIdsFromSource("https://catalog.example/models", "custom", {
			baseUrl: "https://host.example/v1",
		}),
	).rejects.toThrow("HTTP 403");
	await expect(
		fetchModelIdsFromSource("https://host.example/models", "custom", {
			baseUrl: "https://host.example/v1",
			apiKey: "secret",
		}),
	).rejects.toThrow("HTTP 403");
	expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("includes the server's reason in an error", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () =>
			Response.json(
				{ error: { code: "AUTH_002", message: "Invalid API key" } },
				{ status: 401 },
			),
		),
	);
	await expect(
		fetchModelIdsFromSource("http://gateway.lan/v1/models", "custom", {
			baseUrl: "http://gateway.lan/v1",
			apiKey: "sk-test",
		}),
	).rejects.toThrow(
		"failed to fetch models from http://gateway.lan/v1/models: HTTP 401: Invalid API key",
	);
});

it("drops a trailing slash so the request is not redirected", async () => {
	const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
		Response.json({ data: [{ id: "model-a" }] }),
	);
	vi.stubGlobal("fetch", fetchMock);
	await expect(
		fetchModelIdsFromSource("http://gateway.lan/v1/models/", "custom", {
			baseUrl: "http://gateway.lan/v1",
			apiKey: "sk-test",
		}),
	).resolves.toEqual(["model-a"]);
	expect(fetchMock.mock.calls[0][0]).toBe("http://gateway.lan/v1/models");
});

it("says plainly when the source does not answer in time", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			throw new DOMException("The operation timed out.", "TimeoutError");
		}),
	);
	await expect(
		fetchModelIdsFromSource("http://gateway.lan/v1/models", "custom", {
			baseUrl: "http://gateway.lan/v1",
			apiKey: "sk-test",
		}),
	).rejects.toThrow("no response within 30 s");
});
