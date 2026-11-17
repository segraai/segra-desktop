"use client";

import {
	Bug,
	Check,
	Copy,
	ExternalLink,
	Loader2,
	RefreshCw,
	Sparkles,
	Terminal,
} from "lucide-react";
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

// Release builds check GitHub Releases (tauri.conf.json `plugins.updater`);
// dev builds have no endpoints, so their check reports that updates are off.
const UPDATES_ENABLED = true;

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

interface CliInstallStatus {
	state:
		| "installed"
		| "not_installed"
		| "outdated_link"
		| "unavailable"
		| "unsupported";
	commandName: string;
	linkPath: string;
	onPath: boolean;
	pathHint?: string;
	message?: string;
}

/** The PATH line inside a hint ("... : export PATH=...") is what users copy. */
function copyableHint(hint: string): string {
	const index = hint.lastIndexOf(": ");
	return index >= 0 ? hint.slice(index + 2) : hint;
}

function CommandLineRow() {
	const [status, setStatus] = useState<CliInstallStatus | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		let cancelled = false;
		void desktopClient
			.invoke<CliInstallStatus>("cli_install_status")
			.then((next) => {
				if (!cancelled) setStatus(next);
			})
			.catch(() => {
				// Hide the section if the sidecar can't answer.
			});
		return () => {
			cancelled = true;
		};
	}, []);

	if (!status || status.state === "unavailable") return null;

	const run = (command: "install_cli" | "uninstall_cli") => {
		setBusy(true);
		setError(null);
		void desktopClient
			.invoke<CliInstallStatus>(command)
			.then(setStatus)
			.catch((err: unknown) =>
				setError(err instanceof Error ? err.message : String(err)),
			)
			.finally(() => setBusy(false));
	};

	const installed = status.state === "installed";
	const name = status.commandName;
	const hint = status.pathHint;
	return (
		<div className="flex flex-col gap-3 border-b py-4">
			<div className="flex items-center justify-between gap-5 max-[720px]:flex-col max-[720px]:items-stretch">
				<div className="flex flex-col gap-1">
					<p className="text-base font-semibold text-foreground">
						Command-line tool
					</p>
					<p className="text-sm text-muted-foreground">
						Use Segra from your terminal with the{" "}
						<code className="font-mono text-foreground">{name}</code> command.
					</p>
				</div>
				{status.state === "unsupported" ? null : (
					<div className="flex shrink-0 gap-2">
						{installed || status.state === "outdated_link" ? (
							<Button
								disabled={busy}
								onClick={() => run("uninstall_cli")}
								size="sm"
								type="button"
								variant="outline"
							>
								Remove
							</Button>
						) : null}
						<Button
							disabled={busy || installed}
							onClick={() => run("install_cli")}
							size="sm"
							type="button"
							variant={installed ? "outline" : "default"}
						>
							{busy ? (
								<Loader2 className="size-3 animate-spin" />
							) : installed ? (
								<Check className="size-3" />
							) : (
								<Terminal className="size-3" />
							)}
							{installed
								? "Installed"
								: status.state === "outdated_link"
									? "Reinstall"
									: "Install"}
						</Button>
					</div>
				)}
			</div>
			{status.state === "outdated_link" ? (
				<p className="text-sm text-muted-foreground">
					The installed command points at an older copy of Segra Desktop.
					Reinstall to update it.
				</p>
			) : null}
			{status.message ? (
				<p className="text-sm text-muted-foreground">{status.message}</p>
			) : null}
			{error ? <p className="text-sm text-destructive">{error}</p> : null}
			{installed && hint && !status.onPath ? (
				<div className="flex flex-col gap-2">
					<p className="text-sm text-muted-foreground">
						{hint.slice(0, hint.lastIndexOf(": ") + 1)}
					</p>
					<div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
						<code className="min-w-0 flex-1 overflow-x-auto font-mono text-xs whitespace-nowrap text-foreground">
							{copyableHint(hint)}
						</code>
						<Button
							onClick={() => {
								void navigator.clipboard
									?.writeText(copyableHint(hint))
									.then(() => {
										setCopied(true);
										setTimeout(() => setCopied(false), 1500);
									});
							}}
							size="sm"
							title="Copy"
							type="button"
							variant="ghost"
						>
							{copied ? (
								<Check className="size-3" />
							) : (
								<Copy className="size-3" />
							)}
						</Button>
					</div>
				</div>
			) : null}
			{installed ? (
				<p className="text-sm text-muted-foreground">
					Run <code className="font-mono text-foreground">{name}</code> to
					start, or{" "}
					<code className="font-mono text-foreground">
						{name} auth --provider segra
					</code>{" "}
					to sign in.
				</p>
			) : null}
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
// The Segra web app, which hosts the privacy policy and terms.
const SEGRA_WEB_URL = "https://web.segra.ai";
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
				<CommandLineRow />
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
				<div className="flex items-center justify-between gap-5 border-b py-4 max-[720px]:flex-col max-[720px]:items-stretch">
					<div className="flex flex-col gap-1">
						<p className="text-base font-semibold text-foreground">
							Privacy and terms
						</p>
						<p className="text-sm text-muted-foreground">
							What Segra stores, who sees what, and the terms of use.
						</p>
					</div>
					<div className="flex shrink-0 gap-2">
						<Button
							onClick={() => void openExternalUrl(`${SEGRA_WEB_URL}/privacy`)}
							size="sm"
							type="button"
							variant="outline"
						>
							Privacy policy
						</Button>
						<Button
							onClick={() => void openExternalUrl(`${SEGRA_WEB_URL}/terms`)}
							size="sm"
							type="button"
							variant="outline"
						>
							Terms
						</Button>
					</div>
				</div>
				<OpenSourceNotice />
			</section>
		</PageFrame>
	);
}
