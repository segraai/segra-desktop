/**
 * Checks a Segra provider on this computer, before any prompt is sent to it.
 *
 * The Segra server only handles sign-in and 0G billing: it names a provider
 * and mints a short-lived token. Nothing it says about the provider is
 * trusted. Instead:
 *
 * 1. The provider's registration (URL, model, TEE signing key) is read from
 *    the 0G inference contract over a public 0G RPC. The session's endpoint
 *    must be the registered one.
 * 2. The provider's TDX quote (`{url}/v1/quote`) is verified against Intel's
 *    root CA (dcap-qvl), the signing key must be bound to that hardware
 *    (report_data), the dstack event log must replay to the quoted
 *    measurements, the measured docker-compose must contain a model server
 *    (so the model runs inside the TEE), and 0G must have acknowledged the
 *    signer. Separated providers' model TEE is checked the same way.
 * 3. The key that passes becomes the expected signer for each reply's
 *    signature check (segra-verify.ts).
 *
 * Port of the Segra web app's `lib/zg/attestation.ts` and `verdictOf`.
 */

import { sha256, sha384 } from "@noble/hashes/sha2";
import { keccak_256 } from "@noble/hashes/sha3";
import {
	bytesToHex,
	concatBytes,
	hexToBytes,
	utf8ToBytes,
} from "@noble/hashes/utils";

export type SegraCheckStatus = "pass" | "warn" | "fail" | "info";

export interface SegraAttestationCheck {
	id: string;
	label: string;
	status: SegraCheckStatus;
	detail: string;
}

export type SegraArchitecture =
	| "model-in-tee"
	| "model-in-separate-tee"
	| "tee-relay-to-external-api";

/** One provider's check on this computer. Addresses and hashes only. */
export interface SegraAttestation {
	provider: string;
	model: string;
	url: string;
	/** The endpoint the check approved (the session's, equal to the registered one). */
	endpoint: string;
	architecture: SegraArchitecture | null;
	/** Safe to send prompts: every check passed and the model runs in the TEE. */
	trusted: boolean;
	/** One line: why it's trusted, or the first reason it isn't. */
	verdict: string;
	/** The attested key that signs replies; null unless trusted. */
	responseSigner: string | null;
	checks: SegraAttestationCheck[];
	checkedAt: number;
}

interface ZgNetwork {
	rpcUrl: string;
	inference: string;
}

const NETWORKS: Record<"mainnet" | "testnet", ZgNetwork> = {
	mainnet: {
		rpcUrl: "https://evmrpc.0g.ai",
		inference: "0x47340d900bdFec2BD393c626E12ea0656F938d84",
	},
	testnet: {
		rpcUrl: "https://evmrpc-testnet.0g.ai",
		inference: "0xa79F4c8311FF93C06b8CfB403690cc987c93F91E",
	},
};

/** 0G mainnet unless SEGRA_ZG_NETWORK=testnet; SEGRA_ZG_RPC_URL overrides the RPC. */
export function segraZgNetwork(): ZgNetwork {
	const env = typeof process !== "undefined" ? process.env : undefined;
	const network =
		NETWORKS[env?.SEGRA_ZG_NETWORK === "testnet" ? "testnet" : "mainnet"];
	return {
		...network,
		rpcUrl: env?.SEGRA_ZG_RPC_URL?.trim() || network.rpcUrl,
	};
}

// ── The provider's on-chain registration ─────────────────────────────────

export interface OnChainService {
	provider: string;
	serviceType: string;
	url: string;
	model: string;
	verifiability: string;
	additionalInfo: string;
	teeSignerAddress: string;
	teeSignerAcknowledged: boolean;
}

const word = (data: Uint8Array, offset: number) =>
	data.subarray(offset, offset + 32);
const wordNumber = (data: Uint8Array, offset: number) =>
	Number(BigInt(`0x${bytesToHex(word(data, offset))}`));
const wordAddress = (data: Uint8Array, offset: number) =>
	`0x${bytesToHex(word(data, offset).subarray(12))}`;

/** ABI-decodes the `Service` tuple returned by `getService(address)`. */
export function decodeService(result: string): OnChainService {
	const data = hexToBytes(result.replace(/^0x/i, ""));
	if (data.length < 32 * 12)
		throw new Error("The 0G contract returned no service.");
	const tuple = wordNumber(data, 0);
	const head = (index: number) => tuple + index * 32;
	const text = (index: number) => {
		const start = tuple + wordNumber(data, head(index));
		const length = wordNumber(data, start);
		return new TextDecoder().decode(
			data.subarray(start + 32, start + 32 + length),
		);
	};
	return {
		provider: wordAddress(data, head(0)),
		serviceType: text(1),
		url: text(2),
		model: text(6),
		verifiability: text(7),
		additionalInfo: text(8),
		teeSignerAddress: wordAddress(data, head(9)),
		teeSignerAcknowledged: wordNumber(data, head(10)) !== 0,
	};
}

const GET_SERVICE = bytesToHex(
	keccak_256(utf8ToBytes("getService(address)")),
).slice(0, 8);

export async function readOnChainService(
	fetchFn: typeof fetch,
	provider: string,
	network: ZgNetwork = segraZgNetwork(),
): Promise<OnChainService> {
	if (!/^0x[0-9a-f]{40}$/i.test(provider)) {
		throw new Error(`"${provider}" is not a provider address.`);
	}
	const data = `0x${GET_SERVICE}${provider.slice(2).toLowerCase().padStart(64, "0")}`;
	const response = await fetchFn(network.rpcUrl, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "eth_call",
			params: [{ to: network.inference, data }, "latest"],
		}),
		signal: AbortSignal.timeout(20_000),
	});
	if (!response.ok)
		throw new Error(`The 0G RPC returned HTTP ${response.status}.`);
	const body = (await response.json()) as {
		result?: string;
		error?: { message?: string };
	};
	if (!body.result || body.result === "0x") {
		throw new Error(
			`This provider isn't registered on 0G (${body.error?.message ?? "no service"}).`,
		);
	}
	return decodeService(body.result);
}

interface AdditionalInfo {
	ProviderType?: string;
	TargetSeparated?: boolean;
	TargetTeeAddress?: string;
	ImageDigest?: string;
}

export function classifyService(service: OnChainService) {
	let info: AdditionalInfo = {};
	try {
		info = JSON.parse(service.additionalInfo || "{}") as AdditionalInfo;
	} catch {
		// Not JSON: treat as a plain provider.
	}
	let architecture: SegraArchitecture = "model-in-tee";
	let responseSigner = service.teeSignerAddress;
	if (info.ProviderType === "centralized") {
		architecture = "tee-relay-to-external-api";
	} else if (info.TargetSeparated && info.TargetTeeAddress) {
		architecture = "model-in-separate-tee";
		responseSigner = info.TargetTeeAddress;
	}
	return {
		architecture,
		responseSigner,
		imageDigest: info.ImageDigest ?? null,
	};
}

// ── The hardware report ──────────────────────────────────────────────────

interface DstackEvent {
	imr: number;
	event_type: number;
	digest: string;
	event: string;
	event_payload: string;
}

interface RawReport {
	quote?: string;
	intel_quote?: string;
	event_log?: string | DstackEvent[];
	tcb_info?: string | { app_compose?: string };
	info?: { tcb_info?: string | { app_compose?: string } };
	attestation?: {
		evidence?: { app_compose?: string; event_log?: string | DstackEvent[] };
	};
	service_capabilities?: { serving?: string };
}

/** The part of a verified quote these checks read (dcap-qvl's report body). */
export interface QuoteBody {
	tcbStatus: string;
	reportData: Uint8Array;
	rtMr: [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
}

/** Verifies a TDX quote against Intel's root CA. Throws when it doesn't verify. */
export type QuoteVerifier = (quote: Uint8Array) => Promise<QuoteBody>;

export const dcapQuoteVerifier: QuoteVerifier = async (quote) => {
	const { getCollateralAndVerify } = await import("@phala/dcap-qvl");
	const verified = await getCollateralAndVerify(Buffer.from(quote));
	const td = (
		verified.report as unknown as { data: Record<string, Uint8Array> }
	).data;
	return {
		tcbStatus: verified.status,
		reportData: td.reportData,
		rtMr: [td.rtMr0, td.rtMr1, td.rtMr2, td.rtMr3],
	};
};

const MODEL_SERVER =
	/sglang|vllm|text-generation-inference|lmdeploy|tensorrt|triton|llama\.?cpp|ollama/i;

const sameAddress = (a?: string | null, b?: string | null) =>
	!!a && !!b && a.toLowerCase() === b.toLowerCase();

const parseMaybe = <T>(value: string | T | undefined): T | undefined => {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value) as T;
	} catch {
		return undefined;
	}
};

// report_data holds the signer either as an ASCII "0x…" string or as 20 raw bytes.
export function signerFromReportData(reportData: Uint8Array): string {
	const text = new TextDecoder().decode(reportData).replace(/\0+$/, "");
	if (/^0x[0-9a-f]{40}$/i.test(text)) return text;
	return `0x${bytesToHex(reportData.subarray(0, 20))}`;
}

// dstack runtime events (imr 3) ship with an empty digest; it is
// sha384(event_type as u32 LE || ":" || event || ":" || payload bytes).
function eventDigest(event: DstackEvent): Uint8Array {
	if (event.digest) return hexToBytes(event.digest);
	const type = new Uint8Array(4);
	new DataView(type.buffer).setUint32(0, event.event_type, true);
	return sha384(
		concatBytes(
			type,
			utf8ToBytes(":"),
			utf8ToBytes(event.event),
			utf8ToBytes(":"),
			hexToBytes(event.event_payload),
		),
	);
}

export function replayRtmr(events: DstackEvent[], imr: number): string {
	let mr: Uint8Array = new Uint8Array(48);
	for (const event of events.filter((e) => e.imr === imr)) {
		mr = sha384(concatBytes(mr, eventDigest(event)));
	}
	return bytesToHex(mr);
}

function composeImages(appCompose: string): string[] {
	let file = appCompose;
	try {
		file =
			(JSON.parse(appCompose) as { docker_compose_file?: string })
				.docker_compose_file ?? appCompose;
	} catch {
		// Plain YAML.
	}
	const refs = [...file.matchAll(/^\s*image:\s*["']?([\w.\-/:@]+)/gm)].map(
		(m) => m[1],
	);
	return [...new Set(refs.filter((r) => /[a-z]/i.test(r) && /[/:]/.test(r)))];
}

// 0G brokers extend RTMR3 with "zg-image-update" events whose payload is
// "<image>@<digest> <signer address> <hash>" when they roll out a new image.
function latestImageUpdate(events: DstackEvent[]) {
	const last = events.filter((e) => e.event === "zg-image-update").at(-1);
	if (!last) return null;
	const [image = "", signer = ""] = new TextDecoder()
		.decode(hexToBytes(last.event_payload))
		.split(" ");
	return { image, digest: image.split("@")[1] ?? "", signer };
}

async function checkReport(
	scope: string,
	report: RawReport,
	expectedSigner: string,
	acknowledged: boolean | null,
	registeredImageDigest: string | null,
	verifyQuote: QuoteVerifier,
): Promise<{
	checks: SegraAttestationCheck[];
	images: string[];
	aggregator: boolean;
}> {
	const checks: SegraAttestationCheck[] = [];
	const id = (s: string) => `${scope.toLowerCase().replace(/\W+/g, "-")}-${s}`;
	const add = (
		s: string,
		label: string,
		status: SegraCheckStatus,
		detail: string,
	) => checks.push({ id: id(s), label: `${scope}: ${label}`, status, detail });
	const done = () => ({ checks, images: [] as string[], aggregator: false });

	const quoteHex = (report.quote ?? report.intel_quote ?? "").replace(
		/^0x/,
		"",
	);
	if (!quoteHex) {
		add(
			"quote",
			"hardware quote",
			"fail",
			"The provider returned no TDX quote.",
		);
		return done();
	}
	let td: QuoteBody;
	try {
		td = await verifyQuote(hexToBytes(quoteHex));
	} catch (error) {
		add(
			"intel",
			"quote signed by genuine Intel TDX hardware",
			"fail",
			`The quote doesn't verify against Intel's root certificate: ${(error as Error).message}`,
		);
		return done();
	}
	const upToDate = td.tcbStatus === "UpToDate";
	add(
		"intel",
		"quote signed by genuine Intel TDX hardware",
		upToDate ? "pass" : "warn",
		upToDate
			? "The quote verifies up to Intel's root certificate, and the platform's security patches are current."
			: `The quote verifies up to Intel's root certificate, but the platform's patch status is ${td.tcbStatus}.`,
	);

	const quoted = signerFromReportData(td.reportData);
	add(
		"signer",
		"signing key was generated inside this TEE",
		sameAddress(quoted, expectedSigner) ? "pass" : "fail",
		sameAddress(quoted, expectedSigner)
			? `The quote is bound to ${expectedSigner}, the key registered on 0G, so replies signed by it come from this hardware.`
			: `The quote is bound to ${quoted}, not the registered key ${expectedSigner}.`,
	);

	if (acknowledged !== null) {
		add(
			"ack",
			"signer acknowledged on 0G",
			acknowledged ? "pass" : "fail",
			acknowledged
				? "The 0G inference contract has acknowledged this TEE signer."
				: "The 0G inference contract has not acknowledged this TEE signer.",
		);
	}

	const evidence = report.attestation?.evidence;
	const tcb =
		parseMaybe<{ app_compose?: string }>(
			report.tcb_info ?? report.info?.tcb_info,
		) ??
		(evidence?.app_compose ? { app_compose: evidence.app_compose } : undefined);
	const events = parseMaybe<DstackEvent[]>(
		report.event_log ?? evidence?.event_log,
	);
	if (!tcb?.app_compose || !Array.isArray(events)) {
		add(
			"replay",
			"event log replays to the quoted measurements",
			"fail",
			"The report has no event log or app compose, so the running software can't be tied to the hardware quote.",
		);
		return done();
	}

	const mismatched = [0, 1, 2, 3].filter(
		(i) => replayRtmr(events, i) !== bytesToHex(td.rtMr[i]),
	);
	add(
		"replay",
		"event log replays to the quoted measurements",
		mismatched.length === 0 ? "pass" : "fail",
		mismatched.length === 0
			? `Replaying ${events.length} boot and runtime events reproduces RTMR0–3 exactly.`
			: `Replayed RTMR${mismatched.join(", RTMR")} differ from the quote.`,
	);

	const composeEvent = events.find((e) => e.event === "compose-hash");
	const composeHash = bytesToHex(sha256(utf8ToBytes(tcb.app_compose)));
	add(
		"compose",
		"running app matches the measured docker-compose",
		composeEvent?.event_payload === composeHash ? "pass" : "fail",
		composeEvent?.event_payload === composeHash
			? "sha256(app_compose) equals the measured compose-hash event, so the containers are exactly what booted."
			: "The app compose hash doesn't match the measured compose-hash event.",
	);

	const running = latestImageUpdate(events);
	if (running && registeredImageDigest) {
		const ok =
			running.digest === registeredImageDigest &&
			sameAddress(running.signer, expectedSigner);
		add(
			"image",
			"running image matches its 0G registration",
			ok ? "pass" : "warn",
			ok
				? "The last measured image update is the image digest registered on 0G, bound to the same signer."
				: "The last measured image update differs from the image digest registered on 0G.",
		);
	}

	const aggregator = report.service_capabilities?.serving === "aggregator";
	if (aggregator) {
		add(
			"aggregator",
			"forwards to downstream backends",
			"warn",
			"This TEE says it's a gateway that forwards requests to model backends outside the attestation.",
		);
	}
	return { checks, images: composeImages(tcb.app_compose), aggregator };
}

async function fetchReport(
	fetchFn: typeof fetch,
	url: string,
): Promise<RawReport> {
	const response = await fetchFn(url, {
		cache: "no-store",
		signal: AbortSignal.timeout(20_000),
	} as RequestInit);
	if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
	return (await response.json()) as RawReport;
}

const trimSlashes = (value: string) => value.replace(/\/+$/, "");

export interface AttestSegraProviderInput {
	fetch: typeof fetch;
	/** The provider the Segra server picked, and the endpoint and model it gave. */
	provider: string;
	endpoint: string;
	model: string;
	verifyQuote?: QuoteVerifier;
	network?: ZgNetwork;
}

export async function attestSegraProvider(
	input: AttestSegraProviderInput,
): Promise<SegraAttestation> {
	const verifyQuote = input.verifyQuote ?? dcapQuoteVerifier;
	const checks: SegraAttestationCheck[] = [];
	const result = (
		service: OnChainService | null,
		architecture: SegraArchitecture | null,
		responseSigner: string | null,
	): SegraAttestation => {
		const failed = checks.find((c) => c.status === "fail");
		const where = checks.find((c) => c.id === "where-model-runs");
		const trusted = !failed && where?.status === "pass";
		return {
			provider: input.provider,
			model: service?.model ?? input.model,
			url: service?.url ?? "",
			endpoint: input.endpoint,
			architecture,
			trusted,
			verdict: trusted
				? "The model runs inside attested secure hardware."
				: failed
					? `Failed: ${failed.label}. ${failed.detail}`
					: (where?.detail ?? "The provider couldn't be checked."),
			responseSigner: trusted ? responseSigner : null,
			checks,
			checkedAt: Date.now(),
		};
	};

	let service: OnChainService;
	try {
		service = await readOnChainService(
			input.fetch,
			input.provider,
			input.network,
		);
	} catch (error) {
		checks.push({
			id: "registration",
			label: "Provider registered on 0G",
			status: "fail",
			detail: (error as Error).message,
		});
		return result(null, null, null);
	}
	const { architecture, responseSigner, imageDigest } =
		classifyService(service);
	const registeredEndpoint = `${trimSlashes(service.url)}/v1/proxy`;
	const endpointOk =
		trimSlashes(input.endpoint).toLowerCase() ===
		registeredEndpoint.toLowerCase();
	const modelOk = !input.model || input.model === service.model;
	const typeOk =
		service.serviceType === "chatbot" && service.verifiability === "TeeML";
	checks.push({
		id: "registration",
		label: "Provider registered on 0G",
		status: endpointOk && modelOk && typeOk ? "pass" : "fail",
		detail: !typeOk
			? `It's registered as ${service.serviceType} / ${service.verifiability}, not a TEE chat model.`
			: !endpointOk
				? `The Segra server named ${input.endpoint}, but the provider registered ${registeredEndpoint} on 0G.`
				: !modelOk
					? `The Segra server named model ${input.model}, but the provider registered ${service.model} on 0G.`
					: `Read from the 0G inference contract: ${service.url} serving ${service.model}.`,
	});
	if (!endpointOk || !typeOk) return result(service, architecture, null);

	if (architecture === "tee-relay-to-external-api") {
		checks.push({
			id: "where-model-runs",
			label: "Where the model runs",
			status: "fail",
			detail:
				"Per its 0G registration, only a relay runs in a TEE: it forwards prompts to an external model API, whose operator can read them.",
		});
		return result(service, architecture, null);
	}

	const scope = architecture === "model-in-tee" ? "Provider TEE" : "Broker TEE";
	const images: string[] = [];
	let aggregator = false;
	try {
		const broker = await checkReport(
			scope,
			await fetchReport(input.fetch, `${trimSlashes(service.url)}/v1/quote`),
			service.teeSignerAddress,
			service.teeSignerAcknowledged,
			imageDigest,
			verifyQuote,
		);
		checks.push(...broker.checks);
		images.push(...broker.images);
		aggregator ||= broker.aggregator;
	} catch (error) {
		checks.push({
			id: "provider-tee-quote",
			label: `${scope}: hardware quote`,
			status: "fail",
			detail: (error as Error).message,
		});
	}

	if (architecture === "model-in-separate-tee") {
		try {
			const model = await checkReport(
				"Model TEE",
				await fetchReport(
					input.fetch,
					`${trimSlashes(service.url)}/v1/proxy/attestation/report?model=${encodeURIComponent(service.model)}`,
				),
				responseSigner,
				null,
				null,
				verifyQuote,
			);
			checks.push(...model.checks);
			images.push(...model.images);
			aggregator ||= model.aggregator;
		} catch (error) {
			checks.push({
				id: "model-tee-quote",
				label: "Model TEE: hardware quote",
				status: "fail",
				detail: (error as Error).message,
			});
		}
	}

	const modelServers = [...new Set(images)].filter((i) => MODEL_SERVER.test(i));
	checks.push(
		modelServers.length > 0 && !aggregator
			? {
					id: "where-model-runs",
					label: "Where the model runs",
					status: "pass",
					detail: `A model server (${modelServers.join(", ")}) is part of the measured containers, so the model runs inside the attested hardware.`,
				}
			: {
					id: "where-model-runs",
					label: "Where the model runs",
					status: "fail",
					detail: aggregator
						? "The TEE is a gateway that forwards prompts to backends outside the attestation."
						: "No model server (SGLang, vLLM, …) is among the measured containers, so this TEE may forward prompts elsewhere.",
				},
	);
	return result(service, architecture, responseSigner);
}

// ── Cache and local record ───────────────────────────────────────────────

// A passing check is reused for an hour; a failing one is retried on the next call.
const TRUSTED_FOR_MS = 60 * 60_000;
const attestations = new Map<string, Promise<SegraAttestation>>();

/** Checks the provider (cached while it passes) and records the result for the app. */
export function getSegraAttestation(
	input: AttestSegraProviderInput,
): Promise<SegraAttestation> {
	const key = `${input.provider.toLowerCase()}\n${trimSlashes(input.endpoint)}\n${input.model}`;
	const cached = attestations.get(key);
	if (cached) {
		return cached.then((a) => {
			if (a.trusted && Date.now() - a.checkedAt < TRUSTED_FOR_MS) return a;
			if (attestations.get(key) === cached) attestations.delete(key);
			return getSegraAttestation(input);
		});
	}
	const pending = (async () => {
		// The app's "Verifying privacy" step runs the same check in another
		// process just before sending; reuse its pass instead of checking twice.
		const recorded = await readRecordedAttestation(input.provider);
		if (
			recorded?.trusted &&
			recorded.responseSigner &&
			trimSlashes(recorded.endpoint ?? "") === trimSlashes(input.endpoint) &&
			recorded.model === input.model &&
			Date.now() - recorded.checkedAt < TRUSTED_FOR_MS
		) {
			return recorded;
		}
		const a = await attestSegraProvider(input);
		await recordSegraAttestation(a);
		return a;
	})();
	attestations.set(key, pending);
	pending
		.then((a) => {
			if (!a.trusted && attestations.get(key) === pending)
				attestations.delete(key);
		})
		.catch(() => {
			if (attestations.get(key) === pending) attestations.delete(key);
		});
	return pending;
}

/** Test hook. */
export function clearSegraAttestationCache(): void {
	attestations.clear();
}

async function attestationsFile(): Promise<string> {
	const [{ join }, { resolveClineDataDir }] = await Promise.all([
		import("node:path"),
		import("@cline/shared/storage"),
	]);
	return join(resolveClineDataDir(), "segra", "attestations.json");
}

async function readRecordedAttestation(
	provider: string,
): Promise<SegraAttestation | null> {
	try {
		const { readFile } = await import("node:fs/promises");
		const entries = JSON.parse(
			await readFile(await attestationsFile(), "utf8"),
		);
		return (entries?.[provider.toLowerCase()] as SegraAttestation) ?? null;
	} catch {
		return null;
	}
}

/**
 * Writes the latest result per provider to `<cline data dir>/segra/attestations.json`,
 * where Segra Desktop's privacy badge reads it. Best effort.
 */
export async function recordSegraAttestation(
	result: SegraAttestation,
): Promise<void> {
	try {
		const [
			{ mkdir, readFile, rename, writeFile },
			{ join },
			{ resolveClineDataDir },
		] = await Promise.all([
			import("node:fs/promises"),
			import("node:path"),
			import("@cline/shared/storage"),
		]);
		const dir = join(resolveClineDataDir(), "segra");
		const file = join(dir, "attestations.json");
		await mkdir(dir, { recursive: true });
		let entries: Record<string, SegraAttestation> = {};
		try {
			const parsed = JSON.parse(await readFile(file, "utf8"));
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
				entries = parsed;
		} catch {
			// Missing or unreadable: start over.
		}
		entries[result.provider.toLowerCase()] = result;
		const tmp = `${file}.${process.pid}.tmp`;
		await writeFile(tmp, JSON.stringify(entries), { mode: 0o600 });
		await rename(tmp, file);
	} catch {
		// Recording is best effort.
	}
}
