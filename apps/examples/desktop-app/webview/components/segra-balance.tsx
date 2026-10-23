"use client";

import { useEffect, useState } from "react";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import { subscribeToProviderCatalogInvalidation } from "@/lib/provider-model-catalog";
import { cn } from "@/lib/utils";

// `GET {segra}/me`, as relayed by the sidecar's `segra_account` command. Every
// Segra account has its own wallet and a balance in credits.
type SegraAccount = {
	billing?: "wallet";
	userId: string;
	tier?: "free" | "paid";
	credits: number;
	status: "ok" | "setting_up" | "empty";
};

const REFRESH_MS = 30_000;
const AFTER_TURN_MS = 3_000;

const PRICING_NOTE =
	"Each message uses a small amount of your balance. The amount depends on the model, how long the conversation is, and current network rates.";

// Credits keep two decimals when small, whole numbers otherwise (same as the web app).
const formatCredits = (n: number) =>
	n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 2 : 0 });

function balanceLine(account: SegraAccount): { text: string; low: boolean } {
	if (account.status === "setting_up")
		return { low: false, text: "Setting up your account…" };
	if (account.status === "empty") return { low: true, text: "Balance used up" };
	return { low: false, text: `${formatCredits(account.credits)} credits left` };
}

/** The signed-in Segra account's balance; renders nothing when signed out. */
export function SegraBalance({ className }: { className?: string }) {
	const [account, setAccount] = useState<SegraAccount | null>(null);
	const [proUrl, setProUrl] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		const load = () => {
			// No visibility check: WebKitGTK can report a shown window as hidden.
			desktopClient
				.invoke<{ account: SegraAccount | null; proUrl?: string }>(
					"segra_account",
				)
				.then((result) => {
					if (cancelled) return;
					// Anything without a credit balance isn't shown.
					const next = result?.account;
					setAccount(typeof next?.credits === "number" ? next : null);
					setProUrl(result?.proUrl ?? null);
				})
				.catch(() => undefined);
		};
		const timer = window.setInterval(load, REFRESH_MS);
		window.addEventListener("focus", load);
		const unsubscribers = [
			// Loads once the sidecar connection is up (and again after a reconnect).
			desktopClient.subscribeTransportState((state) => {
				if (state === "connected") load();
			}),
			// Sign-in and sign-out change the provider catalog.
			subscribeToProviderCatalogInvalidation(load),
			// A turn finished: usage is reported just after the response ends.
			desktopClient.subscribe("chat_session_status", (payload) => {
				const status = (payload as { status?: unknown } | null)?.status;
				if (status !== "running" && status !== "starting") {
					window.setTimeout(load, AFTER_TURN_MS);
				}
			}),
		];
		return () => {
			cancelled = true;
			window.clearInterval(timer);
			window.removeEventListener("focus", load);
			for (const unsubscribe of unsubscribers) unsubscribe();
		};
	}, []);

	if (!account) return null;
	const { text, low } = balanceLine(account);
	// Free accounts can ask for credits to try Pro (more so once theirs run out).
	const action = proUrl && account.tier === "free" ? "Try Pro" : null;
	return (
		<span
			className={cn(
				"flex min-w-0 items-center gap-2 text-xs tabular-nums",
				className,
			)}
		>
			<span
				className={cn(
					"truncate",
					low ? "text-destructive" : "text-muted-foreground",
				)}
				title={`Signed in to Segra as ${account.userId}. ${PRICING_NOTE}`}
			>
				{text}
			</span>
			{action && proUrl ? (
				<button
					className="shrink-0 font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onClick={() => void openExternalUrl(proUrl)}
					type="button"
				>
					{action}
				</button>
			) : null}
		</span>
	);
}
