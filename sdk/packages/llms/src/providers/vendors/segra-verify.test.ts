import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSegraFetch } from "./segra";
import {
	recoverPersonalSignAddress,
	sha256Hex,
	verifySegraReply,
} from "./segra-verify";

// Made with ethers' Wallet.signMessage in the Segra web app, using the test key 0x11…11.
const SIGNER = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A";
const REQUEST = '{"model":"m","messages":[]}';
const RESPONSE = 'data: {"choices":[]}\n\ndata: [DONE]\n\n';
const SIGNED_TEXT = `${sha256Hex(REQUEST)}:${sha256Hex(RESPONSE)}`;
const SIGNATURE =
	"0x3b897e00c17faec5d75c2e493865bf5e2d6c9458aec4e41e423f0cd05c0af55f6a339eb5ec23f45cf09ddc0b50d2267bd3096a2b2e734cc592d24f559074f1801c";

const noSleep = async () => {};

function signatureFetch(body: unknown, status = 200) {
	return vi.fn(
		async () => new Response(JSON.stringify(body), { status }),
	) as unknown as typeof fetch;
}

const input = {
	endpoint: "https://provider.example/v1/proxy",
	chatId: "chat-1",
	model: "m",
	provider: "0xprovider",
	expectedSigner: SIGNER,
	requestSha256: sha256Hex(REQUEST),
	responseSha256: sha256Hex(RESPONSE),
	sleep: noSleep,
};

describe("recoverPersonalSignAddress", () => {
	it("recovers the address ethers signed with", () => {
		expect(SIGNED_TEXT).toBe(
			"0bfcf1c873fe23e87366969117efdc24b95f341eb2f4abe10ae01e7a1f4994c6:adbdf32496f2a537a5ced4e801070b765254df6e58977aab9440082b1baa929b",
		);
		expect(
			recoverPersonalSignAddress(SIGNED_TEXT, SIGNATURE).toLowerCase(),
		).toBe(SIGNER.toLowerCase());
	});
});

describe("verifySegraReply", () => {
	it("verifies a reply signed by the attested key over these exact bytes", async () => {
		const fetch = signatureFetch({ text: SIGNED_TEXT, signature: SIGNATURE });
		const result = await verifySegraReply({ ...input, fetch });
		expect(result).toMatchObject({
			status: "verified",
			requestHashMatches: true,
			responseHashMatches: true,
		});
		expect(fetch).toHaveBeenCalledWith(
			"https://provider.example/v1/proxy/signature/chat-1?model=m",
			expect.anything(),
		);
	});

	it("fails when another key signed it", async () => {
		const result = await verifySegraReply({
			...input,
			expectedSigner: "0x0000000000000000000000000000000000000001",
			fetch: signatureFetch({ text: SIGNED_TEXT, signature: SIGNATURE }),
		});
		expect(result.status).toBe("failed");
		expect(result.error).toContain("not signed");
	});

	it("fails when the signed hashes don't match what this machine received", async () => {
		const result = await verifySegraReply({
			...input,
			responseSha256: sha256Hex("something else"),
			fetch: signatureFetch({ text: SIGNED_TEXT, signature: SIGNATURE }),
		});
		expect(result).toMatchObject({
			status: "failed",
			responseHashMatches: false,
		});
	});

	it("still verifies when only the request hash differs", async () => {
		const result = await verifySegraReply({
			...input,
			requestSha256: sha256Hex(
				"the provider signs its own form of the request",
			),
			fetch: signatureFetch({ text: SIGNED_TEXT, signature: SIGNATURE }),
		});
		expect(result).toMatchObject({
			status: "verified",
			requestHashMatches: false,
			responseHashMatches: true,
		});
	});

	it("is unavailable without a chat id, a signer, or a published signature", async () => {
		const fetch = signatureFetch({}, 404);
		expect(
			(await verifySegraReply({ ...input, chatId: null, fetch })).status,
		).toBe("unavailable");
		expect(
			(await verifySegraReply({ ...input, expectedSigner: undefined, fetch }))
				.status,
		).toBe("unavailable");
		const missing = await verifySegraReply({ ...input, fetch, attempts: 2 });
		expect(missing.status).toBe("unavailable");
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});

describe("createSegraFetch verification", () => {
	let dataDir: string;
	beforeEach(() => {
		// The check is recorded under the data dir; keep it out of the real one.
		dataDir = mkdtempSync(join(tmpdir(), "segra-verify-test-"));
		vi.stubEnv("CLINE_DATA_DIR", dataDir);
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(dataDir, { recursive: true, force: true });
	});

	it("hashes the exact bytes sent and received and reports the result with usage", async () => {
		const calls: Array<{ url: string; body?: string }> = [];
		const sse =
			'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":4}}\n\ndata: [DONE]\n\n';
		const sentBody = '{"model":"m","messages":[],"stream":true}';
		let usageReport: Record<string, unknown> | undefined;
		const baseFetch = vi.fn(
			async (url: string | URL | Request, init?: RequestInit) => {
				const href = String(url);
				calls.push({ url: href, body: init?.body as string | undefined });
				if (href.endsWith("/session")) {
					return Response.json({
						provider: "0xprovider",
						endpoint: "https://provider.example/v1/proxy",
						model: "m",
						token: "t",
						expiresAt: Date.now() + 15 * 60_000,
						signer: SIGNER,
					});
				}
				if (href.includes("/signature/")) {
					// The provider signs sha256(request):sha256(response) for what it actually saw.
					return Response.json({
						text: `${sha256Hex(sentBody)}:${sha256Hex(sse)}`,
						signature: "0x00",
					});
				}
				if (href.endsWith("/usage")) {
					usageReport = JSON.parse(init?.body as string);
					return Response.json({ ok: true });
				}
				return new Response(sse, {
					headers: {
						"content-type": "text/event-stream",
						"zg-res-key": "chat-9",
					},
				});
			},
		) as unknown as typeof fetch;

		const segraFetch = createSegraFetch(
			baseFetch,
			"https://segra.example/api/app/v1",
		);
		const response = await segraFetch(
			"https://segra.example/api/app/v1/chat/completions",
			{
				method: "POST",
				headers: { authorization: "Bearer sk-segra-test" },
				body: sentBody,
			},
		);
		expect(await response.text()).toBe(sse);
		await vi.waitFor(() => expect(usageReport).toBeDefined());
		// The dummy signature can't recover a key, so the check fails, and the report says so.
		expect(usageReport).toMatchObject({
			chatId: "chat-9",
			inputTokens: 3,
			outputTokens: 4,
			verification: "failed",
		});
		expect(
			calls.some(
				(call) =>
					call.url ===
					"https://provider.example/v1/proxy/signature/chat-9?model=m",
			),
		).toBe(true);
		await vi.waitFor(() => {
			const recorded = JSON.parse(
				readFileSync(join(dataDir, "segra", "verifications.json"), "utf8"),
			);
			expect(recorded[0]).toMatchObject({ chatId: "chat-9", status: "failed" });
			expect(JSON.stringify(recorded)).not.toContain("choices");
		});
	});
});
