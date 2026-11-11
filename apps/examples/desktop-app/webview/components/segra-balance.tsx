"use client";

import { RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import { openSettingsSection } from "@/lib/privacy";
import { subscribeToProviderCatalogInvalidation } from "@/lib/provider-model-catalog";
import { cn } from "@/lib/utils";

// `GET {segra}/me`, as relayed by the sidecar's `segra_account` command. Every
// Segra account has its own wallet and a balance in credits.
export type SegraAccount = {
	billing?: "wallet";
	userId: string;
	tier?: "free" | "paid";
	credits: number;
	status: "ok" | "setting_up" | "empty";
};

const REFRESH_MS = 30_000;
const AFTER_TURN_MS = 3_000;

export const PRICING_NOTE =
	"Each message uses a small amount of your balance. The amount depends on the model, how long the conversation is, and current network rates.";

// Credits keep two decimals when small, whole numbers otherwise (same as the web app).
export const formatCredits = (n: number) =>
	n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 2 : 0 });

function balanceLine(account: SegraAccount): { text: string; low: boolean } {
	if (account.status === "setting_up")
		return { low: false, text: "Setting up your account…" };
	if (account.status === "empty") return { low: true, text: "Balance used up" };
	return { low: false, text: `${formatCredits(account.credits)} credits left` };
}

export type SegraAccountState = {
	account: SegraAccount | null;
	proUrl: string | null;
	/** Null until the first answer; true with a null account means Segra couldn't be reached. */
	signedIn: boolean | null;
	/** Reloads now; resolves once the answer is in. */
	refresh: () => Promise<void>;
};

/** The signed-in Segra account, kept fresh while the app is open. */
export function useSegraAccount(): SegraAccountState {
	const [account, setAccount] = useState<SegraAccount | null>(null);
	const [proUrl, setProUrl] = useState<string | null>(null);
	const [signedIn, setSignedIn] = useState<boolean | null>(null);
	const loadRef = useRef<() => Promise<void>>(async () => undefined);

	useEffect(() => {
		let cancelled = false;
		const load = () =>
			// No visibility check: WebKitGTK can report a shown window as hidden.
			desktopClient
				.invoke<{
					account: SegraAccount | null;
					proUrl?: string;
					signedIn?: boolean;
				}>("segra_account")
				.then((result) => {
					if (cancelled) return;
					// Anything without a credit balance isn't shown.
					const next = result?.account;
					setAccount(typeof next?.credits === "number" ? next : null);
					setProUrl(result?.proUrl ?? null);
					setSignedIn(result?.signedIn ?? Boolean(next));
				})
				.catch(() => undefined);
		loadRef.current = load;
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

	const refresh = useCallback(() => loadRef.current(), []);
	return { account, proUrl, signedIn, refresh };
}

/** Reloads the balance, spinning until the answer is in. */
export function RefreshBalanceButton({
	className,
	onRefresh,
}: {
	className?: string;
	onRefresh: () => Promise<void>;
}) {
	const [refreshing, setRefreshing] = useState(false);
	return (
		<button
			aria-label="Refresh credits"
			className={cn(
				"inline-flex shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
				className,
			)}
			disabled={refreshing}
			onClick={() => {
				setRefreshing(true);
				void onRefresh().finally(() => setRefreshing(false));
			}}
			title="Refresh credits"
			type="button"
		>
			<RotateCw className={cn("size-3.5", refreshing && "animate-spin")} />
		</button>
	);
}

/**
 * The signed-in Segra account's balance; renders nothing when signed out.
 * Clicking it opens Settings → Account.
 */
export function SegraBalance({ className }: { className?: string }) {
	const { account, proUrl, refresh } = useSegraAccount();

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
			<button
				className={cn(
					"truncate rounded-sm hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
					low ? "text-destructive" : "text-muted-foreground",
				)}
				onClick={() => openSettingsSection("Account")}
				title={`Signed in to Segra as ${account.userId}. ${PRICING_NOTE}`}
				type="button"
			>
				{text}
			</button>
			<RefreshBalanceButton className="size-5" onRefresh={refresh} />
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
