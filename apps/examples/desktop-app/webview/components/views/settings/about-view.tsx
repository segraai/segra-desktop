"use client";

import { Bug, ExternalLink, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MemoizedMarkdown } from "@/components/ui/markdown";
import { WhatsNewDialog } from "@/components/whats-new-dialog";
import {
	checkForUpdateNow,
	restartToApplyUpdate,
	useAppUpdateStatus,
} from "@/hooks/use-app-update";
import { isBetaVersion, productNameForVersion } from "@/lib/app-channel";
import {
	CHANGELOG_URL_ON_GITHUB,
	type ChangelogRelease,
	fetchChangelog,
	ISSUES_URL,
	releaseUrl,
} from "@/lib/changelog";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import { latestWhatsNew } from "@/lib/whats-new";
import { PageFrame, PageHeader } from "../page-layout";

const RECENT_RELEASE_COUNT = 5;

function useAppVersion(): string | null {
	const [appVersion, setAppVersion] = useState<string | null>(null);
	useEffect(() => {
		let cancelled = false;
		void desktopClient
			.invoke<{ appVersion?: unknown }>("get_process_context")
			.then((context) => {
				if (cancelled) return;
				const version =
					typeof context?.appVersion === "string"
						? context.appVersion.trim()
						: "";
				setAppVersion(version || null);
			})
			.catch(() => {
				// Stay versionless if the sidecar is unreachable.
			});
		return () => {
			cancelled = true;
		};
	}, []);
	return appVersion;
}

// Segra: no update server is set up yet (the updater has no endpoints), so
// the Updates row is hidden. Turn this on once updates are published.
const UPDATES_ENABLED = false;

function UpdateRow() {
	const status = useAppUpdateStatus();
	const [checking, setChecking] = useState(false);
	const [checkResult, setCheckResult] = useState<
		"up-to-date" | "unavailable" | null
	>(null);
	const [restarting, setRestarting] = useState(false);

	const busy =
		checking || status.state === "checking" || status.state === "downloading";
	const description =
		status.state === "ready"
			? `Version ${status.version} is downloaded and will be used the next time Segra Desktop starts.`
			: status.state === "downloading"
				? `Downloading version ${status.version ?? ""}…`
				: status.state === "error" && status.error
					? `The last check failed: ${status.error}`
					: checkResult === "up-to-date"
						? "You're up to date. Segra Desktop also checks on its own shortly after launch and every two hours."
						: checkResult === "unavailable"
							? "Update checks are only available in the desktop app."
							: "Segra Desktop checks for updates shortly after launch and every two hours, and installs them when it restarts.";

	return (
		<div className="flex items-center justify-between gap-5 border-b py-4 max-[720px]:flex-col max-[720px]:items-stretch">
			<div className="flex flex-col gap-1">
				<p className="text-base font-semibold text-foreground">Updates</p>
				<p className="text-sm text-muted-foreground">{description}</p>
			</div>
			{status.state === "ready" ? (
				<Button
					className="shrink-0"
					disabled={restarting}
					onClick={() => {
						setRestarting(true);
						void restartToApplyUpdate().then((ok) => {
							if (!ok) setRestarting(false);
						});
					}}
					size="sm"
					type="button"
				>
					{restarting ? <Loader2 className="size-3 animate-spin" /> : null}
					Restart to update
				</Button>
			) : (
				<Button
					className="shrink-0"
					disabled={busy}
					onClick={() => {
						setChecking(true);
						void checkForUpdateNow().then((result) => {
							setChecking(false);
							setCheckResult(result ? "up-to-date" : "unavailable");
						});
					}}
					size="sm"
					type="button"
					variant="outline"
				>
					{busy ? (
						<Loader2 className="size-3 animate-spin" />
					) : (
						<RefreshCw className="size-3" />
					)}
					Check for updates
				</Button>
			)}
		</div>
	);
}

function ReleaseNotes({
	appVersion,
	releases,
	error,
}: {
	appVersion: string | null;
	releases: ChangelogRelease[] | null;
	error: string | null;
}) {
	if (error) {
		return <p className="py-4 text-sm text-muted-foreground">{error}</p>;
	}
	if (!releases) {
		return (
			<p className="py-4 text-sm text-muted-foreground">
				Loading release notes…
			</p>
		);
	}
	return (
		<ol className="flex flex-col">
			{releases.slice(0, RECENT_RELEASE_COUNT).map((release) => (
				<li
					className="grid gap-x-8 gap-y-2 border-b py-5 last:border-b-0 sm:grid-cols-[8rem_1fr]"
					key={release.version}
				>
					<div className="flex items-start gap-2">
						<button
							className="font-mono text-sm text-foreground hover:underline"
							onClick={() => void openExternalUrl(releaseUrl(release.version))}
							title="Open this release on GitHub"
							type="button"
						>
							v{release.version}
						</button>
						{release.version === appVersion ? (
							<Badge variant="secondary">Installed</Badge>
						) : null}
					</div>
					<MemoizedMarkdown
						classNames="text-sm text-muted-foreground [&_li]:my-1 [&_ul]:pl-4"
						content={release.notes.map((note) => `- ${note}`).join("\n")}
					/>
				</li>
			))}
		</ol>
	);
}

const SEGRA_SUPPORT_URL = "https://segra.ai";
const CLINE_REPO_URL = "https://github.com/cline/cline";

/**
 * Apache-2.0 attribution for the Cline codebase Segra Desktop is built on. The
 * license text ships in public/licenses so it is available offline.
 */
function OpenSourceNotice() {
	const [license, setLicense] = useState<string | null>(null);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		if (!open || license !== null) return;
		fetch("/licenses/cline-LICENSE.txt")
			.then((response) => response.text())
			.then(setLicense)
			.catch(() => setLicense("The license text could not be loaded."));
	}, [open, license]);

	return (
		<div className="pt-6">
			<h2 className="text-lg font-semibold text-foreground">Open source</h2>
			<p className="mt-2 text-sm text-muted-foreground">
				Segra Desktop is based on{" "}
				<button
					className="underline underline-offset-2 hover:text-foreground"
					onClick={() => void openExternalUrl(CLINE_REPO_URL)}
					type="button"
				>
					Cline
				</button>
				, Copyright 2026 Cline Bot Inc., licensed under the Apache License,
				Version 2.0. Segra has modified it, including the Segra provider,
				sign-in, web search, and branding. Cline is a trademark of Cline Bot
				Inc.; Segra Desktop is not affiliated with or endorsed by Cline.
			</p>
			<Button
				className="mt-3 -ml-2 text-muted-foreground"
				onClick={() => setOpen((value) => !value)}
				size="sm"
				type="button"
				variant="ghost"
			>
				{open ? "Hide license" : "View license"}
			</Button>
			{open ? (
				<pre className="mt-2 max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
					{license ?? "Loading…"}
				</pre>
			) : null}
		</div>
	);
}

export function AboutContent({
	onOpenConnectors,
}: {
	onOpenConnectors: () => void;
}) {
	const appVersion = useAppVersion();
	const [releases, setReleases] = useState<ChangelogRelease[] | null>(null);
	const [changelogError, setChangelogError] = useState<string | null>(null);
	const [whatsNewOpen, setWhatsNewOpen] = useState(false);
	const whatsNew = latestWhatsNew();

	useEffect(() => {
		let cancelled = false;
		fetchChangelog()
			.then((loaded) => {
				if (!cancelled) setReleases(loaded);
			})
			.catch(() => {
				if (!cancelled) {
					setChangelogError(
						"Release notes aren't available in this build. The full changelog is on GitHub.",
					);
				}
			});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<PageFrame>
			<PageHeader
				meta={
					<span className="flex items-center gap-2">
						{appVersion ? (
							<span className="font-mono text-base text-muted-foreground">
								v{appVersion}
							</span>
						) : null}
						{isBetaVersion(appVersion) ? (
							<Badge className="uppercase tracking-wide" variant="secondary">
								Beta
							</Badge>
						) : null}
					</span>
				}
				title={productNameForVersion(appVersion)}
			/>
			<section className="max-w-344">
				{UPDATES_ENABLED ? <UpdateRow /> : null}
				{whatsNew ? (
					<div className="flex items-center justify-between gap-5 border-b py-4 max-[720px]:flex-col max-[720px]:items-stretch">
						<div className="flex flex-col gap-1">
							<p className="text-base font-semibold text-foreground">
								Highlights
							</p>
							<p className="text-sm text-muted-foreground">
								A short tour of the biggest recent additions.
							</p>
						</div>
						<Button
							className="shrink-0"
							onClick={() => setWhatsNewOpen(true)}
							size="sm"
							type="button"
							variant="outline"
						>
							<Sparkles className="size-3" />
							Show what's new
						</Button>
						<WhatsNewDialog
							onOpenChange={setWhatsNewOpen}
							onOpenConnectors={onOpenConnectors}
							open={whatsNewOpen}
							release={whatsNew}
						/>
					</div>
				) : null}
				<div className="flex items-center justify-between gap-5 border-b py-4 max-[720px]:flex-col max-[720px]:items-stretch">
					<div className="flex flex-col gap-1">
						<p className="text-base font-semibold text-foreground">Get help</p>
						<p className="text-sm text-muted-foreground">
							Found a bug or have a request? Contact Segra.
						</p>
					</div>
					<Button
						className="shrink-0"
						onClick={() => void openExternalUrl(SEGRA_SUPPORT_URL)}
						size="sm"
						type="button"
						variant="outline"
					>
						<Bug className="size-3" />
						Visit segra.ai
					</Button>
				</div>
				<OpenSourceNotice />
			</section>
		</PageFrame>
	);
}
