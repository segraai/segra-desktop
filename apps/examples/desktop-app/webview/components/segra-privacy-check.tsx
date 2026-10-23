"use client";

import { ShieldAlert, ShieldCheck, ShieldEllipsis } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { desktopClient } from "@/lib/desktop-client";
import { cn } from "@/lib/utils";

interface CheckResult {
	attestation: { trusted: boolean; verdict: string } | null;
	error?: string;
}

type State =
	| { kind: "idle" }
	| { kind: "checking" }
	| { kind: "verified" }
	| { kind: "failed"; verdict: string };

// What the check does, shown in turn while it runs (segra-attest.ts).
const STEPS = [
	"Reading the provider's registration on 0G",
	"Checking Intel's signature on the hardware report",
	"Confirming the software running inside",
	"Confirming the model runs inside the secure hardware",
];
const STEP_MS = 800;
// Long enough to read, even when a recent pass makes the check instant.
const MIN_CHECKING_MS = 1_600;
const VERIFIED_MS = 1_000;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The "Verifying privacy" step before a chat's first Segra message: a large
 * badge over the chat while this computer checks the provider itself
 * (sidecar `segra_check_provider`). `run` resolves true to send, false when
 * the provider failed (the message is not sent and the overlay explains why).
 * When no check could start (signed out, no credits…) it resolves true, so
 * the reply shows the server's error as usual.
 */
export function useSegraPrivacyCheck(): {
	run: (model: string) => Promise<boolean>;
	overlay: ReactNode;
} {
	const [state, setState] = useState<State>({ kind: "idle" });
	const mounted = useRef(true);
	useEffect(() => {
		// Set on every mount: React's dev double-mount runs the cleanup once.
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	const run = useCallback(async (model: string) => {
		setState({ kind: "checking" });
		const started = Date.now();
		const result = await desktopClient
			.invoke<CheckResult>("segra_check_provider", { model })
			.catch(
				(error): CheckResult => ({ attestation: null, error: String(error) }),
			);
		const attestation = result?.attestation;
		if (!attestation) {
			if (mounted.current) setState({ kind: "idle" });
			return true;
		}
		await wait(Math.max(0, MIN_CHECKING_MS - (Date.now() - started)));
		if (!attestation.trusted) {
			if (mounted.current)
				setState({ kind: "failed", verdict: attestation.verdict });
			return false;
		}
		if (mounted.current) setState({ kind: "verified" });
		await wait(VERIFIED_MS);
		if (mounted.current) setState({ kind: "idle" });
		return true;
	}, []);

	// Over the chat pane (right of the sidebar), or the window if there is none.
	const pane =
		typeof document === "undefined"
			? null
			: document.querySelector<HTMLElement>('[data-slot="sidebar-inset"]');
	const overlay =
		state.kind === "idle" || typeof document === "undefined"
			? null
			: createPortal(
					<PrivacyCheckOverlay
						contained={Boolean(pane)}
						onClose={() => setState({ kind: "idle" })}
						state={state}
					/>,
					pane ?? document.body,
				);
	return { run, overlay };
}

function PrivacyCheckOverlay({
	state,
	contained,
	onClose,
}: {
	state: Exclude<State, { kind: "idle" }>;
	contained: boolean;
	onClose: () => void;
}) {
	const [step, setStep] = useState(0);
	useEffect(() => {
		if (state.kind !== "checking") return;
		setStep(0);
		const timer = window.setInterval(
			() => setStep((s) => Math.min(s + 1, STEPS.length - 1)),
			STEP_MS,
		);
		return () => window.clearInterval(timer);
	}, [state.kind]);

	const Icon =
		state.kind === "verified"
			? ShieldCheck
			: state.kind === "failed"
				? ShieldAlert
				: ShieldEllipsis;
	const tone = state.kind === "failed" ? "text-destructive" : "text-primary";

	return (
		<div
			aria-live="polite"
			className={cn(
				"inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm",
				contained ? "absolute" : "fixed",
			)}
		>
			<div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border bg-background p-8 text-center shadow-lg">
				<div className="relative flex size-28 items-center justify-center">
					{state.kind === "checking" ? (
						<>
							<span className="absolute inset-0 rounded-full bg-primary/15 motion-safe:animate-ping" />
							<span className="absolute inset-3 rounded-full border-2 border-primary/30 border-t-primary motion-safe:animate-spin" />
						</>
					) : null}
					<span
						className={cn(
							"relative flex size-20 items-center justify-center rounded-full",
							state.kind === "failed" ? "bg-destructive/10" : "bg-primary/10",
							state.kind === "verified" &&
								"motion-safe:animate-in motion-safe:zoom-in-75",
						)}
					>
						<Icon aria-hidden="true" className={cn("size-11", tone)} />
					</span>
				</div>

				{state.kind === "checking" ? (
					<>
						<p className="text-lg font-semibold">Verifying privacy…</p>
						<p className="min-h-10 text-sm text-muted-foreground">
							{STEPS[step]}
						</p>
						<p className="text-xs text-muted-foreground">
							Checked on this computer, before anything is sent.
						</p>
					</>
				) : state.kind === "verified" ? (
					<>
						<p className={cn("text-lg font-semibold", tone)}>
							Privacy verified
						</p>
						<p className="text-sm text-muted-foreground">
							The model runs inside genuine secure hardware. No one else can
							read your messages. Sending…
						</p>
					</>
				) : (
					<>
						<p className={cn("text-lg font-semibold", tone)}>
							Message not sent
						</p>
						<p className="text-sm text-muted-foreground">
							This computer couldn&apos;t confirm that the provider runs the
							model inside secure hardware, so nothing was sent.
						</p>
						<p className="text-xs text-muted-foreground">{state.verdict}</p>
						<Button onClick={onClose} type="button">
							Back to chat
						</Button>
					</>
				)}
			</div>
		</div>
	);
}
