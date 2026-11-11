"use client";

import { Check, ChevronRight, Copy, Loader2, RotateCw } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import {
	formatCredits,
	PRICING_NOTE,
	RefreshBalanceButton,
	type SegraAccount,
	useSegraAccount,
} from "@/components/segra-balance";
import { SegraLogo } from "@/components/segra-logo";
import { Button } from "@/components/ui/button";
import { useClineSignIn } from "@/hooks/use-cline-sign-in";
import { useOAuthUserCode } from "@/hooks/use-oauth-user-code";
import { openExternalUrl } from "@/lib/desktop-client";
import { invalidateProviderCatalogCache } from "@/lib/provider-model-catalog";
import { cn } from "@/lib/utils";
import { PageFrame, PageHeader } from "../page-layout";

function statusText(account: SegraAccount): string {
	if (account.status === "setting_up") return "Setting up your account…";
	if (account.status === "empty") return "Balance used up";
	return "Active";
}

function CopyButton({ value }: { value: string }) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = window.setTimeout(() => setCopied(false), 1500);
		return () => window.clearTimeout(timer);
	}, [copied]);
	return (
		<Button
			aria-label={copied ? "Copied" : "Copy account ID"}
			className="h-7 shrink-0 px-2 text-xs"
			onClick={() => {
				void navigator.clipboard.writeText(value).then(() => setCopied(true));
			}}
			type="button"
			variant="ghost"
		>
			{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
			{copied ? "Copied" : "Copy"}
		</Button>
	);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex min-h-12 items-center justify-between gap-4 px-4 py-2">
			<dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
			<dd className="flex min-w-0 items-center gap-2 text-sm text-foreground">
				{children}
			</dd>
		</div>
	);
}

function SignInCard() {
	const signIn = useClineSignIn({
		provider: "segra",
		onSuccess: async () => {},
		onSettled: invalidateProviderCatalogCache,
	});
	const userCode = useOAuthUserCode(signIn.signingIn);
	return (
		<section className="max-w-2xl rounded-xl border p-5">
			<div className="flex items-start gap-4">
				<SegraLogo className="size-10" />
				<div className="min-w-0 flex-1">
					<h2 className="text-lg font-semibold text-foreground">
						Not signed in
					</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						Sign in to Segra to use its private models and see your account ID
						and credits here.
					</p>
				</div>
			</div>
			<div className="mt-4 flex items-center justify-end gap-2">
				{signIn.signingIn ? (
					<Button
						className="h-8 px-3 text-sm"
						disabled={signIn.cancelling}
						onClick={() => void signIn.cancelSignIn()}
						type="button"
						variant="ghost"
					>
						Cancel
					</Button>
				) : null}
				<Button
					className="h-8 px-3 text-sm"
					disabled={signIn.signingIn}
					onClick={() => void signIn.signIn()}
					type="button"
				>
					{signIn.signingIn ? (
						<Loader2 className="size-4 animate-spin" />
					) : null}
					{signIn.signingIn ? "Waiting for browser…" : "Sign in to Segra"}
				</Button>
			</div>
			{signIn.signingIn && userCode ? (
				<p className="mt-3 text-right text-sm text-muted-foreground">
					Confirm this code in your browser:{" "}
					<span className="font-mono font-medium text-foreground">
						{userCode}
					</span>
				</p>
			) : null}
			{signIn.error ? (
				<p className="mt-3 text-xs text-destructive" role="alert">
					Sign in failed: {signIn.error}
				</p>
			) : null}
		</section>
	);
}

/** Settings → Account: the signed-in Segra account's ID and credits. */
export function AccountContent({
	onManageSegra,
}: {
	/** Opens Segra's provider page (models, sign out). */
	onManageSegra: () => void;
}) {
	const { account, proUrl, signedIn, refresh } = useSegraAccount();

	let body: ReactNode;
	if (signedIn === null) {
		body = (
			<p className="flex items-center gap-2 text-sm text-muted-foreground">
				<Loader2 className="size-4 animate-spin" />
				Loading your account…
			</p>
		);
	} else if (!signedIn) {
		body = <SignInCard />;
	} else if (!account) {
		body = (
			<section className="max-w-2xl rounded-xl border p-5">
				<p className="text-sm text-foreground">
					You're signed in, but Segra couldn't be reached to load your account.
				</p>
				<div className="mt-4 flex justify-end">
					<Button
						className="h-8 px-3 text-sm"
						onClick={() => void refresh()}
						type="button"
						variant="outline"
					>
						<RotateCw className="size-4" />
						Try again
					</Button>
				</div>
			</section>
		);
	} else {
		const low = account.status === "empty";
		body = (
			<div className="flex max-w-2xl flex-col gap-6">
				<section
					aria-label="Credits"
					className="rounded-xl border-2 border-primary/40 bg-primary/5 p-5"
				>
					<div className="flex items-center justify-between gap-2">
						<p className="text-sm text-muted-foreground">Credits left</p>
						<RefreshBalanceButton className="size-7" onRefresh={refresh} />
					</div>
					<p
						className={cn(
							"mt-1 text-4xl font-semibold tabular-nums",
							low ? "text-destructive" : "text-foreground",
						)}
					>
						{formatCredits(account.credits)}
					</p>
					<p className="mt-2 text-sm text-muted-foreground">{PRICING_NOTE}</p>
					{proUrl && account.tier === "free" ? (
						<div className="mt-4 flex justify-end">
							<Button
								className="h-8 px-3 text-sm"
								onClick={() => void openExternalUrl(proUrl)}
								type="button"
							>
								Try Pro
							</Button>
						</div>
					) : null}
				</section>
				<section aria-label="Account details">
					<h2 className="text-lg font-semibold text-foreground">
						Segra account
					</h2>
					<dl className="mt-3 divide-y rounded-lg border">
						<Row label="Account ID">
							<span
								className="truncate font-mono text-xs"
								title={account.userId}
							>
								{account.userId}
							</span>
							<CopyButton value={account.userId} />
						</Row>
						<Row label="Plan">{account.tier === "paid" ? "Pro" : "Free"}</Row>
						<Row label="Status">
							<span className={cn(low && "text-destructive")}>
								{statusText(account)}
							</span>
						</Row>
					</dl>
				</section>
				<div className="flex justify-end">
					<Button
						className="h-8 px-3 text-sm"
						onClick={onManageSegra}
						type="button"
						variant="outline"
					>
						Models and sign out
						<ChevronRight className="size-4" />
					</Button>
				</div>
			</div>
		);
	}

	return (
		<PageFrame>
			<PageHeader
				description="Your Segra account. Credits pay for messages to Segra's models; models on this computer are free."
				title="Account"
			/>
			{body}
		</PageFrame>
	);
}
