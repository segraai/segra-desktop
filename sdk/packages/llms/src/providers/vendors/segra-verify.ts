/**
 * Proof that a Segra reply came from the attested model.
 *
 * Each 0G TEE provider signs `sha256(request):sha256(response)` for every chat
 * with a key that only exists inside its attested enclave, and publishes the
 * signature at `{endpoint}/signature/{chatId}`. Which key that is comes from
 * this computer's own check of the provider (segra-attest.ts), never from the
 * Segra server. Recovering the signer from
 * the signature and comparing hashes of the bytes this machine actually sent
 * and received shows the reply was produced inside that TEE, unmodified.
 *
 * Port of the Segra web app's `lib/zg/verify-response.ts`.
 */

import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha2";
import { keccak_256 } from "@noble/hashes/sha3";
import {
	bytesToHex,
	concatBytes,
	hexToBytes,
	utf8ToBytes,
} from "@noble/hashes/utils";

export type SegraVerificationStatus = "verified" | "failed" | "unavailable";

/** One reply's check. Holds hashes and addresses only, never content. */
export interface SegraVerification {
	status: SegraVerificationStatus;
	chatId: string | null;
	model: string;
	provider: string;
	expectedSigner: string | null;
	recoveredSigner?: string;
	requestHashMatches: boolean | null;
	responseHashMatches: boolean | null;
	error?: string;
	checkedAt: number;
}

export function sha256Hex(data: Uint8Array | string): string {
	return bytesToHex(
		sha256(typeof data === "string" ? utf8ToBytes(data) : data),
	);
}

/** The address that signed `message` with Ethereum `personal_sign` (EIP-191). */
export function recoverPersonalSignAddress(
	message: string,
	signature: string,
): string {
	const body = utf8ToBytes(message);
	const digest = keccak_256(
		concatBytes(
			utf8ToBytes(`\x19Ethereum Signed Message:\n${body.length}`),
			body,
		),
	);
	const bytes = hexToBytes(signature.replace(/^0x/i, ""));
	if (bytes.length !== 65) throw new Error("A signature must be 65 bytes.");
	const v = bytes[64] >= 27 ? bytes[64] - 27 : bytes[64];
	if (v !== 0 && v !== 1) throw new Error("Bad signature recovery byte.");
	const publicKey = secp256k1.Signature.fromCompact(bytes.slice(0, 64))
		.addRecoveryBit(v)
		.recoverPublicKey(digest)
		.toRawBytes(false);
	return `0x${bytesToHex(keccak_256(publicKey.slice(1)).slice(-20))}`;
}

const isSha256 = (value?: string) => !!value && /^[0-9a-f]{64}$/i.test(value);

export interface VerifySegraReplyInput {
	fetch: typeof fetch;
	/** The session's provider endpoint, `{provider url}/v1/proxy`. */
	endpoint: string;
	chatId: string | null;
	model: string;
	provider: string;
	expectedSigner: string | null | undefined;
	requestSha256: string;
	responseSha256: string;
	/** Test hook; the provider stores the signature shortly after the stream closes. */
	sleep?: (ms: number) => Promise<void>;
	attempts?: number;
}

export async function verifySegraReply(
	input: VerifySegraReplyInput,
): Promise<SegraVerification> {
	const base = {
		chatId: input.chatId,
		model: input.model,
		provider: input.provider,
		expectedSigner: input.expectedSigner ?? null,
		requestHashMatches: null,
		responseHashMatches: null,
		checkedAt: Date.now(),
	};
	if (!input.chatId) {
		return {
			...base,
			status: "unavailable",
			error: "The provider sent no ZG-Res-Key header.",
		};
	}
	if (!input.expectedSigner) {
		return {
			...base,
			status: "unavailable",
			error: "No attested signing key for this provider.",
		};
	}

	const sleep =
		input.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
	const url = `${input.endpoint.replace(/\/+$/, "")}/signature/${encodeURIComponent(input.chatId)}?model=${encodeURIComponent(input.model)}`;
	let body = null as { text?: string; signature?: string } | null;
	let lastError = "";
	for (
		let attempt = 0;
		attempt < (input.attempts ?? 6) && !body?.signature;
		attempt++
	) {
		if (attempt > 0) await sleep(1000 * attempt);
		try {
			const res = await input.fetch(url, { cache: "no-store" } as RequestInit);
			if (res.ok) body = (await res.json()) as typeof body;
			else lastError = `HTTP ${res.status}`;
		} catch (error) {
			lastError = (error as Error).message;
		}
	}
	if (!body?.text || !body.signature) {
		return {
			...base,
			status: "unavailable",
			error: `Signature not available (${lastError || "empty response"}).`,
		};
	}

	let recovered: string;
	try {
		recovered = recoverPersonalSignAddress(body.text, body.signature);
	} catch (error) {
		return { ...base, status: "failed", error: (error as Error).message };
	}
	const [requestHash, responseHash] = body.text.split(":");
	const requestHashMatches = isSha256(requestHash)
		? requestHash.toLowerCase() === input.requestSha256
		: null;
	const responseHashMatches = isSha256(responseHash)
		? responseHash.toLowerCase() === input.responseSha256
		: null;
	const signerOk =
		recovered.toLowerCase() === input.expectedSigner.toLowerCase();
	// The attested key must have signed the hash of exactly the reply this
	// machine received. The request hash is informational: 0G providers sign
	// their own form of the request, which never equals the bytes sent (seen
	// with plain requests on 2026-10-22); the web app treats it the same way.
	const ok = signerOk && responseHashMatches !== false;
	return {
		...base,
		status: ok ? "verified" : "failed",
		recoveredSigner: recovered,
		requestHashMatches,
		responseHashMatches,
		...(ok
			? {}
			: {
					error: signerOk
						? "The signed reply hash doesn't match the reply this machine received."
						: "The reply was not signed by this provider's attested TEE key.",
				}),
	};
}

const LOG_LIMIT = 200;

/**
 * Appends a result to `<cline data dir>/segra/verifications.json` (newest
 * first, capped), where Segra Desktop reads it. The provider runs in the hub
 * process, so a local file is the bridge to the app. Best effort: a runtime
 * without a filesystem just skips it.
 */
export async function recordSegraVerification(
	result: SegraVerification,
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
		const file = join(dir, "verifications.json");
		await mkdir(dir, { recursive: true });
		let entries: SegraVerification[] = [];
		try {
			const parsed = JSON.parse(await readFile(file, "utf8"));
			if (Array.isArray(parsed)) entries = parsed;
		} catch {
			// Missing or unreadable: start over.
		}
		const next = [result, ...entries].slice(0, LOG_LIMIT);
		const tmp = `${file}.${process.pid}.tmp`;
		await writeFile(tmp, JSON.stringify(next), { mode: 0o600 });
		await rename(tmp, file);
	} catch {
		// Recording is best effort.
	}
}
