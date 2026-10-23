import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	attestSegraProvider,
	clearSegraAttestationCache,
	decodeService,
	getSegraAttestation,
	type OnChainService,
	type QuoteVerifier,
	replayRtmr,
} from "./segra-attest";

const PROVIDER = "0x4870cbc4d07d6ac2ee5aa865588e5985fe77a4e9";
const TEE_SIGNER = "0x745720517fa4a03a17a5c3525b4060f7a41b46ed";
const MODEL_SIGNER = "0x1111111111111111111111111111111111111111";
const URL_ = "https://provider.test";
const NETWORK = { rpcUrl: "https://rpc.test", inference: "0xinference" };

// ── ABI encoding of the contract's Service tuple ────────────────────────

const pad = (hex: string) => hex.padStart(64, "0");
const num = (n: number | bigint) => pad(BigInt(n).toString(16));
const addr = (a: string) => pad(a.slice(2).toLowerCase());
function str(value: string) {
	const bytes = bytesToHex(utf8ToBytes(value));
	return (
		num(value.length) + bytes.padEnd(Math.ceil(bytes.length / 64) * 64, "0")
	);
}

function encodeService(s: OnChainService): string {
	const strings = [
		s.serviceType,
		s.url,
		s.model,
		s.verifiability,
		s.additionalInfo,
	];
	const tails: string[] = [];
	const offsets: number[] = [];
	let offset = 11 * 32;
	for (const value of strings) {
		offsets.push(offset);
		const tail = str(value);
		tails.push(tail);
		offset += tail.length / 2;
	}
	const head = [
		addr(s.provider),
		num(offsets[0]),
		num(offsets[1]),
		num(1),
		num(2),
		num(3),
		num(offsets[2]),
		num(offsets[3]),
		num(offsets[4]),
		addr(s.teeSignerAddress),
		num(s.teeSignerAcknowledged ? 1 : 0),
	];
	return `0x${num(32)}${head.join("")}${tails.join("")}`;
}

const service = (over: Partial<OnChainService> = {}): OnChainService => ({
	provider: PROVIDER,
	serviceType: "chatbot",
	url: URL_,
	model: "0GM-1.0-35B-A3B",
	verifiability: "TeeML",
	additionalInfo: JSON.stringify({ ImageDigest: "sha256:abc" }),
	teeSignerAddress: TEE_SIGNER,
	teeSignerAcknowledged: true,
	...over,
});

// ── A synthetic dstack report and a quote verifier that "verifies" it ────

const hexOf = (text: string) => bytesToHex(utf8ToBytes(text));

function makeReport(options: { image?: string; signer?: string } = {}) {
	const compose = JSON.stringify({
		docker_compose_file: `services:\n  llm:\n    image: ${options.image ?? "lmsysorg/sglang:v0.4.6"}\n  broker:\n    image: 0g/broker:1\n`,
	});
	const signer = options.signer ?? TEE_SIGNER;
	const events = [
		{
			imr: 0,
			event_type: 1,
			digest: "aa".repeat(48),
			event: "",
			event_payload: "",
		},
		{
			imr: 1,
			event_type: 1,
			digest: "bb".repeat(48),
			event: "",
			event_payload: "",
		},
		{
			imr: 2,
			event_type: 1,
			digest: "cc".repeat(48),
			event: "",
			event_payload: "",
		},
		{
			imr: 3,
			event_type: 134217729,
			digest: "",
			event: "compose-hash",
			event_payload: bytesToHex(sha256(utf8ToBytes(compose))),
		},
		{
			imr: 3,
			event_type: 134217729,
			digest: "",
			event: "zg-image-update",
			event_payload: hexOf(`0g/broker@sha256:abc ${signer} x`),
		},
	];
	return {
		report: {
			quote: "0x00",
			event_log: JSON.stringify(events),
			tcb_info: { app_compose: compose },
		},
		events,
		signer,
	};
}

type Report = ReturnType<typeof makeReport>;

const verifierFor =
	(
		report: Report,
		over: { tcbStatus?: string; boundTo?: string } = {},
	): QuoteVerifier =>
	async () => ({
		tcbStatus: over.tcbStatus ?? "UpToDate",
		reportData: utf8ToBytes((over.boundTo ?? report.signer).padEnd(64, "\0")),
		rtMr: [0, 1, 2, 3].map((i) =>
			Uint8Array.from(Buffer.from(replayRtmr(report.events, i), "hex")),
		) as [Uint8Array, Uint8Array, Uint8Array, Uint8Array],
	});

function fakeFetch(
	registered: OnChainService,
	reports: Record<string, unknown>,
) {
	const calls: string[] = [];
	const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		calls.push(url);
		if (url === NETWORK.rpcUrl)
			return Response.json({
				jsonrpc: "2.0",
				id: 1,
				result: encodeService(registered),
			});
		if (url in reports) return Response.json(reports[url]);
		return new Response("not found", { status: 404 });
	});
	return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const attest = (
	fetchImpl: typeof fetch,
	verifyQuote: QuoteVerifier,
	endpoint = `${URL_}/v1/proxy`,
) =>
	attestSegraProvider({
		fetch: fetchImpl,
		provider: PROVIDER,
		endpoint,
		model: "0GM-1.0-35B-A3B",
		verifyQuote,
		network: NETWORK,
	});

describe("decodeService", () => {
	it("reads the contract's Service tuple", () => {
		const s = service({
			teeSignerAcknowledged: false,
			additionalInfo: "x".repeat(70),
		});
		expect(decodeService(encodeService(s))).toEqual(s);
	});
});

describe("attestSegraProvider", () => {
	it("trusts a registered provider whose hardware report checks out", async () => {
		const report = makeReport();
		const { fetchImpl } = fakeFetch(service(), {
			[`${URL_}/v1/quote`]: report.report,
		});
		const result = await attest(fetchImpl, verifierFor(report));
		expect(result.checks.filter((c) => c.status !== "pass")).toEqual([]);
		expect(result.trusted).toBe(true);
		expect(result.responseSigner).toBe(TEE_SIGNER);
	});

	it("refuses an endpoint the provider didn't register on 0G, without contacting it", async () => {
		const report = makeReport();
		const { fetchImpl, calls } = fakeFetch(service(), {
			[`${URL_}/v1/quote`]: report.report,
		});
		const result = await attest(
			fetchImpl,
			verifierFor(report),
			"https://evil.test/v1/proxy",
		);
		expect(result.trusted).toBe(false);
		expect(result.verdict).toContain("https://evil.test/v1/proxy");
		expect(calls).toEqual([NETWORK.rpcUrl]);
	});

	it("refuses a relay to an external API", async () => {
		const report = makeReport();
		const { fetchImpl } = fakeFetch(
			service({
				additionalInfo: JSON.stringify({ ProviderType: "centralized" }),
			}),
			{
				[`${URL_}/v1/quote`]: report.report,
			},
		);
		expect((await attest(fetchImpl, verifierFor(report))).trusted).toBe(false);
	});

	it("refuses a TEE with no model server inside", async () => {
		const report = makeReport({ image: "nginx:1.27" });
		const { fetchImpl } = fakeFetch(service(), {
			[`${URL_}/v1/quote`]: report.report,
		});
		const result = await attest(fetchImpl, verifierFor(report));
		expect(result.trusted).toBe(false);
		expect(result.responseSigner).toBeNull();
	});

	it("refuses a quote bound to a different key", async () => {
		const report = makeReport();
		const { fetchImpl } = fakeFetch(service(), {
			[`${URL_}/v1/quote`]: report.report,
		});
		const result = await attest(
			fetchImpl,
			verifierFor(report, { boundTo: MODEL_SIGNER }),
		);
		expect(result.trusted).toBe(false);
		expect(result.verdict).toContain("signing key");
	});

	it("refuses an event log that doesn't replay to the quote", async () => {
		const report = makeReport();
		const verify = verifierFor(report);
		report.report.event_log = JSON.stringify([
			{ ...report.events[0], digest: "dd".repeat(48) },
			...report.events.slice(1),
		]);
		const { fetchImpl } = fakeFetch(service(), {
			[`${URL_}/v1/quote`]: report.report,
		});
		expect((await attest(fetchImpl, verify)).trusted).toBe(false);
	});

	it("refuses a quote that doesn't verify against Intel's root", async () => {
		const report = makeReport();
		const { fetchImpl } = fakeFetch(service(), {
			[`${URL_}/v1/quote`]: report.report,
		});
		const result = await attest(fetchImpl, async () => {
			throw new Error("bad certificate chain");
		});
		expect(result.trusted).toBe(false);
		expect(result.verdict).toContain("bad certificate chain");
	});

	it("refuses a signer 0G hasn't acknowledged", async () => {
		const report = makeReport();
		const { fetchImpl } = fakeFetch(service({ teeSignerAcknowledged: false }), {
			[`${URL_}/v1/quote`]: report.report,
		});
		expect((await attest(fetchImpl, verifierFor(report))).trusted).toBe(false);
	});

	it("checks the separate model TEE and expects replies signed by its key", async () => {
		const broker = makeReport({ image: "0g/broker:1" });
		const model = makeReport({ signer: MODEL_SIGNER });
		const { fetchImpl } = fakeFetch(
			service({
				additionalInfo: JSON.stringify({
					TargetSeparated: true,
					TargetTeeAddress: MODEL_SIGNER,
				}),
			}),
			{
				[`${URL_}/v1/quote`]: broker.report,
				[`${URL_}/v1/proxy/attestation/report?model=0GM-1.0-35B-A3B`]:
					model.report,
			},
		);
		let quotes = 0;
		const verify: QuoteVerifier = async (quote) =>
			verifierFor(quotes++ === 0 ? broker : model)(quote);
		const result = await attest(fetchImpl, verify);
		expect(result.architecture).toBe("model-in-separate-tee");
		expect(result.trusted).toBe(true);
		expect(result.responseSigner).toBe(MODEL_SIGNER);
	});
});

describe("getSegraAttestation", () => {
	let dataDir: string;
	beforeEach(() => {
		dataDir = mkdtempSync(join(tmpdir(), "segra-attest-"));
		vi.stubEnv("CLINE_DATA_DIR", dataDir);
		clearSegraAttestationCache();
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(dataDir, { recursive: true, force: true });
	});

	it("reuses a passing check, re-checks a failing one, and records the latest for the app", async () => {
		const report = makeReport();
		const { fetchImpl, calls } = fakeFetch(service(), {
			[`${URL_}/v1/quote`]: report.report,
		});
		const input = {
			fetch: fetchImpl,
			provider: PROVIDER,
			endpoint: `${URL_}/v1/proxy`,
			model: "0GM-1.0-35B-A3B",
			network: NETWORK,
		};
		await getSegraAttestation({ ...input, verifyQuote: verifierFor(report) });
		await getSegraAttestation({ ...input, verifyQuote: verifierFor(report) });
		expect(calls.filter((c) => c === NETWORK.rpcUrl)).toHaveLength(1);

		const bad = { ...input, model: "other" };
		await getSegraAttestation({ ...bad, verifyQuote: verifierFor(report) });
		await getSegraAttestation({ ...bad, verifyQuote: verifierFor(report) });
		expect(calls.filter((c) => c === NETWORK.rpcUrl)).toHaveLength(3);

		const recorded = JSON.parse(
			readFileSync(join(dataDir, "segra", "attestations.json"), "utf8"),
		);
		expect(recorded[PROVIDER].trusted).toBe(false);
	});

	it("reuses a pass the app's privacy step just recorded, from another process", async () => {
		const { fetchImpl, calls } = fakeFetch(service(), {});
		mkdirSync(join(dataDir, "segra"), { recursive: true });
		writeFileSync(
			join(dataDir, "segra", "attestations.json"),
			JSON.stringify({
				[PROVIDER]: {
					provider: PROVIDER,
					model: "0GM-1.0-35B-A3B",
					url: URL_,
					endpoint: `${URL_}/v1/proxy`,
					architecture: "model-in-tee",
					trusted: true,
					verdict: "ok",
					responseSigner: TEE_SIGNER,
					checks: [],
					checkedAt: Date.now(),
				},
			}),
		);
		const input = {
			fetch: fetchImpl,
			provider: PROVIDER,
			model: "0GM-1.0-35B-A3B",
			network: NETWORK,
		};
		const reused = await getSegraAttestation({
			...input,
			endpoint: `${URL_}/v1/proxy`,
		});
		expect(reused.responseSigner).toBe(TEE_SIGNER);
		expect(calls).toEqual([]);
		// A recorded pass for another endpoint doesn't count.
		await getSegraAttestation({
			...input,
			endpoint: "https://evil.test/v1/proxy",
		});
		expect(calls).toEqual([NETWORK.rpcUrl]);
	});
});
