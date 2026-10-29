"use client";

import { HardDrive, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import {
	NOT_PRIVATE_PROMISE,
	openSettingsSection,
	PRIVATE_PROMISE,
} from "@/lib/privacy";
import { cn } from "@/lib/utils";

/** One reply's TEE signature check (segra-verify.ts in @cline/llms). */
export interface SegraVerification {
	status: "verified" | "failed" | "unavailable";
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

/** The provider check this computer ran before sending it anything (segra-attest.ts). */
interface Attestation {
	trusted: boolean;
	verdict: string;
	checkedAt: number;
	checks: { id: string; label: string; status: string }[];
}

// The check runs after a reply ends and can take a few seconds (the provider
// publishes its signature shortly after the stream closes).
const AFTER_TURN_DELAYS_MS = [2_000, 6_000, 12_000, 20_000];

const short = (address?: string | null) =>
	address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "unknown";

const yesNo = (value: boolean | null) =>
	value === null ? "not signed" : value ? "match" : "don't match";

function badgeFor(latest: SegraVerification | undefined) {
	if (!latest) {
		return {
			Icon: Shield,
			label: "Private",
			tone: "text-muted-foreground",
			summary:
				"Each reply's signature is checked once it arrives. Send a message to see the first check.",
		};
	}
	if (latest.status === "verified") {
		return {
			Icon: ShieldCheck,
			label: "Verified",
			tone: "text-primary",
			summary:
				"This computer checked the provider's secure hardware (TEE) itself, and the last reply was signed inside it, over exactly the reply received.",
		};
	}
	if (latest.status === "failed") {
		return {
			Icon: ShieldAlert,
			label: "Not verified",
			tone: "text-destructive",
			summary: `The last reply failed its signature check: ${latest.error ?? "unknown reason"}`,
		};
	}
	return {
		Icon: Shield,
		label: "Unchecked",
		tone: "text-muted-foreground",
		summary: `The last reply couldn't be checked: ${latest.error ?? "no signature"}`,
	};
}

/** Composer badge: did the last Segra reply prove it came from the TEE? */
export function SegraPrivacyBadge({ model }: { model: string }) {
	const [entries, setEntries] = useState<SegraVerification[]>([]);
	const [verifyUrl, setVerifyUrl] = useState<string | null>(null);
	const [attestation, setAttestation] = useState<
		Attestation | null | "loading"
	>(null);

	const load = useCallback(() => {
		desktopClient
			.invoke<{ entries: SegraVerification[]; verifyUrl?: string | null }>(
				"segra_verifications",
			)
			.then((result) => {
				setEntries(result?.entries ?? []);
				setVerifyUrl(result?.verifyUrl ?? null);
			})
			.catch(() => undefined);
	}, []);

	useEffect(() => {
		load();
		const timers = new Set<number>();
		const unsubscribe = desktopClient.subscribe(
			"chat_session_status",
			(payload) => {
				const status = (payload as { status?: unknown } | null)?.status;
				if (status === "running" || status === "starting") return;
				for (const delay of AFTER_TURN_DELAYS_MS) {
					const timer = window.setTimeout(() => {
						timers.delete(timer);
						load();
					}, delay);
					timers.add(timer);
				}
			},
		);
		window.addEventListener("focus", load);
		return () => {
			unsubscribe();
			window.removeEventListener("focus", load);
			for (const timer of timers) window.clearTimeout(timer);
		};
	}, [load]);

	const latest = entries.find((entry) => entry.model === model);
	const { Icon, label, tone, summary } = badgeFor(latest);

	const loadAttestation = () => {
		if (!latest?.provider) return;
		setAttestation("loading");
		desktopClient
			.invoke<{ attestation: Attestation | null }>("segra_attestation", {
				provider: latest.provider,
			})
			.then((result) => setAttestation(result?.attestation ?? null))
			.catch(() => setAttestation(null));
	};

	return (
		<Popover
			onOpenChange={(open) => {
				if (open) loadAttestation();
			}}
		>
			<PopoverTrigger asChild>
				<button
					aria-label={`Privacy: ${label}`}
					className={cn(
						"inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
						tone,
					)}
					title={summary}
					type="button"
				>
					<Icon aria-hidden="true" className="size-3.5" />
					{label}
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 text-sm" side="top">
				<p className={cn("font-medium", tone)}>{label}</p>
				<p className="mt-1 text-muted-foreground">{PRIVATE_PROMISE}</p>
				<p className="mt-2 text-muted-foreground">{summary}</p>
				{latest ? (
					<dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
						<dt className="text-muted-foreground">Model</dt>
						<dd>{latest.model}</dd>
						<dt className="text-muted-foreground">Signed by</dt>
						<dd className="font-mono">{short(latest.recoveredSigner)}</dd>
						<dt className="text-muted-foreground">Attested key</dt>
						<dd className="font-mono">{short(latest.expectedSigner)}</dd>
						<dt className="text-muted-foreground">Reply hash</dt>
						<dd>{yesNo(latest.responseHashMatches)}</dd>
						<dt className="text-muted-foreground">Checked</dt>
						<dd>{new Date(latest.checkedAt).toLocaleTimeString()}</dd>
					</dl>
				) : null}
				{latest ? (
					<div className="mt-3 border-t pt-3 text-xs">
						<p className="font-medium">Provider check, on this computer</p>
						{attestation === "loading" ? (
							<p className="mt-1 text-muted-foreground">Loading…</p>
						) : attestation ? (
							<>
								<p
									className={cn(
										"mt-1",
										attestation.trusted ? "text-primary" : "text-destructive",
									)}
								>
									{attestation.trusted
										? `All checks passed at ${new Date(attestation.checkedAt).toLocaleTimeString()}, before anything was sent.`
										: attestation.verdict}
								</p>
								<ul className="mt-1 space-y-0.5 text-muted-foreground">
									{attestation.checks.slice(0, 12).map((check) => (
										<li key={check.id}>
											{check.status === "pass"
												? "✓"
												: check.status === "fail"
													? "✗"
													: "•"}{" "}
											{check.label}
										</li>
									))}
								</ul>
							</>
						) : (
							<p className="mt-1 text-muted-foreground">
								Not checked yet: it runs before the first message to this
								provider.
							</p>
						)}
					</div>
				) : null}
				{verifyUrl ? (
					<button
						className="mt-3 text-xs font-medium text-primary hover:underline"
						onClick={() =>
							void openExternalUrl(
								latest?.provider
									? `${verifyUrl}?provider=${encodeURIComponent(latest.provider)}`
									: verifyUrl,
							)
						}
						type="button"
					>
						Learn how each check works, and what a failure would mean →
					</button>
				) : null}
				<PrivacyPageLink />
			</PopoverContent>
		</Popover>
	);
}

function PrivacyPageLink() {
	return (
		<button
			className="mt-2 block text-xs font-medium text-primary hover:underline"
			onClick={() => openSettingsSection("Privacy")}
			type="button"
		>
			What stays on this computer, and what doesn't →
		</button>
	);
}

/** True when the provider's endpoint is this computer (Ollama, LM Studio…). */
export function isLoopbackUrl(url: string | undefined): boolean {
	if (!url) return false;
	try {
		const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
		return (
			host === "localhost" ||
			host === "::1" ||
			host === "0.0.0.0" ||
			/^127\./.test(host)
		);
	} catch {
		return false;
	}
}

/**
 * Composer badge for every provider other than Segra: says plainly whether
 * the chat leaves this computer.
 */
export function ProviderPrivacyBadge({
	providerName,
	local,
	summary: summaryOverride,
}: {
	providerName: string;
	local: boolean;
	/** Replaces the generic text, e.g. for the built-in local models. */
	summary?: string;
}) {
	const Icon = local ? HardDrive : ShieldAlert;
	const label = local ? "On this computer" : "Not private";
	const tone = local
		? "text-muted-foreground"
		: "text-amber-600 dark:text-amber-400";
	const summary =
		summaryOverride ??
		(local
			? `${providerName} runs at an address on this computer, so models it runs locally keep your messages and files here. Some local apps can also forward to online models (like Ollama's cloud models), which then see them.`
			: NOT_PRIVATE_PROMISE(providerName));
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					aria-label={`Privacy: ${label}`}
					className={cn(
						"inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
						tone,
					)}
					title={summary}
					type="button"
				>
					<Icon aria-hidden="true" className="size-3.5" />
					{label}
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 text-sm" side="top">
				<p className={cn("font-medium", tone)}>{label}</p>
				<p className="mt-1 text-muted-foreground">{summary}</p>
				{local ? null : (
					<p className="mt-2 text-muted-foreground">
						To keep your work private, pick Segra in the model picker.
					</p>
				)}
				<PrivacyPageLink />
			</PopoverContent>
		</Popover>
	);
}
