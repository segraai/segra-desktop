"use client";

import { AgentWelcomeHero, Button, IconButton } from "@cline/ui";
import {
	ArrowLeft,
	Check,
	CheckCircle2,
	HardDrive,
	Import,
	Loader2,
	ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ImportSessionsDialog } from "@/components/import-sessions-dialog";
import { SegraWelcomeHero } from "@/components/segra-logo";
import { SEGRA_DEFAULT_MODEL_ID } from "@/hooks/chat-session/constants";
import { useClineSignIn } from "@/hooks/use-cline-sign-in";
import { useOAuthUserCode } from "@/hooks/use-oauth-user-code";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import {
	formatBytes,
	SEGRA_LOCAL_PROVIDER_ID,
	startLocalModelDownload,
	useLocalModels,
} from "@/lib/local-models";
import {
	readModelSelectionStorageFromWindow,
	writeModelSelectionStorageToWindow,
} from "@/lib/model-selection";
import {
	invalidateProviderCatalogCache,
	loadProviderModels,
} from "@/lib/provider-model-catalog";
import {
	type ListImportableSessionsResponse,
	SESSION_IMPORT_TOOL_LABELS,
	SESSION_IMPORT_TOOL_ORDER,
	type SessionImportTool,
} from "@/lib/session-import";
import { cn } from "@/lib/utils";

const SEGRA_SIGN_IN_BENEFITS = [
	"Private models running in sealed hardware (TEEs)",
	"Your code and prompts never pass through Segra",
	"Uses your Segra credits, no API keys to copy",
];

// First run leads with Segra, the right fit for most people; running models on
// this computer is offered below it for those who want the most privacy.
const SEGRA_CLOUD_POINTS = [
	"Powerful models that answer quickly, on any computer.",
	"Not as private as running the AI yourself, but protection the big AI companies don't give you: the AI runs in sealed, secure hardware (a TEE) that no one can look inside, not the company hosting it and not Segra.",
	"Before anything is sent, this computer checks that the hardware is genuine and sealed.",
	"Uses your Segra credits, no API keys to copy.",
];
const LOCAL_ONLY_NOTE =
	"The most private option: nothing leaves this computer, and it works offline. But local models are slow on most computers and give simpler answers.";

export type OnboardingStep = "welcome" | "connect" | "import" | "done";

type OnboardingConnection = {
	kind: "provider";
	providerName: string;
	/** Replaces "<provider> is connected." on the last step. */
	message?: string;
};

/**
 * Remembers the connected provider (and its default model when known) so the
 * chat composer opens pointed at what the user just set up.
 */
function rememberProviderSelection(provider: {
	id: string;
	defaultModelId?: string;
}): void {
	const selection = readModelSelectionStorageFromWindow();
	writeModelSelectionStorageToWindow({
		lastProvider: provider.id,
		lastModelByProvider: provider.defaultModelId
			? {
					...selection.lastModelByProvider,
					[provider.id]: provider.defaultModelId,
				}
			: selection.lastModelByProvider,
	});
}

function OnboardingContent({
	children,
	surface = "plain",
}: {
	children: React.ReactNode;
	surface?: "panel" | "plain" | "transparent";
}) {
	return (
		<div
			className={cn(
				"relative z-10 w-full max-w-148 rounded-2xl p-8 pb-6 max-[720px]:p-5",
				surface === "panel" && "border border-border bg-background",
				surface === "plain" && "bg-background",
				surface === "transparent" && "bg-transparent",
			)}
			data-onboarding-content={surface}
		>
			{children}
		</div>
	);
}

function SetupOptionHeader({
	accessory,
	description,
	icon,
	title,
}: {
	accessory?: React.ReactNode;
	description: React.ReactNode;
	icon: React.ReactNode;
	title: string;
}) {
	return (
		<div className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-4 text-left max-[720px]:gap-x-3 max-[720px]:gap-y-3">
			<span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/4 text-muted-foreground max-[720px]:mt-0">
				{icon}
			</span>
			<div className="min-w-0 mt-1 max-[720px]:col-span-3 max-[720px]:col-start-1 max-[720px]:row-start-2 max-[720px]:mt-0">
				<h4 className="text-lg font-semibold text-foreground">{title}</h4>
				<div className="mt-2 text-sm text-muted-foreground">{description}</div>
			</div>
			{accessory ? (
				<div className="mt-1 max-[720px]:col-start-3 max-[720px]:row-start-1 max-[720px]:mt-0">
					{accessory}
				</div>
			) : null}
		</div>
	);
}

function OptionPoints({ points }: { points: readonly string[] }) {
	return (
		<ul className="flex flex-col gap-1">
			{points.map((point) => (
				<li className="flex gap-2" key={point}>
					<Check
						aria-hidden="true"
						className="mt-0.5 size-3.5 shrink-0 text-primary"
					/>
					<span>{point}</span>
				</li>
			))}
		</ul>
	);
}

function WelcomeStep({ onContinue }: { onContinue: () => void }) {
	return (
		<OnboardingContent surface="transparent">
			<div className="flex flex-col items-center py-4 text-center">
				<div className="w-full">
					<SegraWelcomeHero grid={false} />
				</div>
				<h1 className="mt-5 text-4xl font-semibold text-foreground">
					Segra Desktop
				</h1>
				<p className="mt-2 text-lg text-foreground">Private AI for your work</p>
				<p className="mt-6 text-md text-muted-foreground">
					Segra Desktop is an AI agent. It reads your files, edits them, runs
					commands, and searches the web from your machine. Its models run in
					sealed, secure hardware, or on this computer if you prefer, so your
					work stays private.
				</p>
				<Button
					className="mt-8 w-full max-w-64"
					onClick={onContinue}
					size="lg"
					tone="accent"
					type="button"
					variant="fill"
				>
					Get started
				</Button>
				<p className="mt-8 text-xs text-muted-foreground">
					Takes less than a minute. Everything can be changed later in Settings.
				</p>
			</div>
		</OnboardingContent>
	);
}

function ConnectStep({
	onBack,
	onConnected,
	onSkip,
}: {
	onBack: () => void;
	onConnected: (connection: OnboardingConnection) => void;
	onSkip: () => void;
}) {
	const segraSignIn = useClineSignIn({
		provider: "segra",
		onSuccess: async (signal) => {
			// Open the composer on a real Segra model rather than a placeholder.
			const defaultModelId = await loadProviderModels("segra")
				.then(
					(models) =>
						models.find((model) => model.id === SEGRA_DEFAULT_MODEL_ID)?.id ??
						models[0]?.id,
				)
				.catch(() => undefined);
			if (signal.aborted) return;
			rememberProviderSelection({ id: "segra", defaultModelId });
			onConnected({ kind: "provider", providerName: "Segra" });
		},
		onSettled: invalidateProviderCatalogCache,
	});
	const segraUserCode = useOAuthUserCode(segraSignIn.signingIn);
	const local = useLocalModels();
	const localAvailable = Boolean(local.state?.engine.available);
	const recommended = local.state?.models.find(
		(model) => model.id === local.state?.recommendedId,
	);
	const [startingLocal, setStartingLocal] = useState(false);
	const useThisComputer = async () => {
		if (!recommended) return;
		setStartingLocal(true);
		try {
			await startLocalModelDownload(recommended.id);
			rememberProviderSelection({
				id: SEGRA_LOCAL_PROVIDER_ID,
				defaultModelId: recommended.id,
			});
			onConnected({
				kind: "provider",
				providerName: "On this computer",
				message: recommended.downloaded
					? `${recommended.name} is ready on this computer.`
					: `${recommended.name} is downloading. The new chat screen shows its progress, and you can start as soon as it's ready.`,
			});
		} finally {
			setStartingLocal(false);
		}
	};

	return (
		<OnboardingContent surface="panel">
			<div className="flex flex-col">
				<IconButton
					aria-label="Back"
					className="-ml-2"
					onClick={onBack}
					size="md"
					tone="neutral"
					type="button"
					variant="ghost"
				>
					<ArrowLeft className="size-4" />
				</IconButton>
				<h1 className="mt-6 text-2xl font-semibold tracking-tight text-foreground">
					{localAvailable ? "Choose where the AI runs" : "Sign in with Segra"}
				</h1>
				<p className="mt-4 text-sm text-muted-foreground">
					{localAvailable
						? "Segra is the best fit for most people. You can change this later in Settings."
						: "Sign in once in your browser. Segra Desktop then uses your Segra account and credits."}
				</p>
			</div>

			<div
				className={cn(
					"mt-8 rounded-xl border border-primary/20 bg-primary/4 p-6 pb-8 ring-1 ring-primary/20 ring-inset",
				)}
				data-onboarding-option="segra"
			>
				<SetupOptionHeader
					accessory={
						localAvailable ? (
							<span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
								Recommended
							</span>
						) : undefined
					}
					description={
						<OptionPoints
							points={
								localAvailable ? SEGRA_CLOUD_POINTS : SEGRA_SIGN_IN_BENEFITS
							}
						/>
					}
					icon={<ShieldCheck className="size-5" />}
					title={localAvailable ? "Segra's secure cloud" : "Private by design"}
				/>
				<div className="mt-8 ml-12 flex flex-wrap items-center gap-1 max-[720px]:ml-0">
					<Button
						disabled={segraSignIn.signingIn || startingLocal}
						onClick={() => void segraSignIn.signIn()}
						size="md"
						tone="accent"
						type="button"
						variant="fill"
					>
						{segraSignIn.signingIn && (
							<Loader2 className="size-4 animate-spin" />
						)}
						{segraSignIn.signingIn
							? "Waiting for browser..."
							: localAvailable
								? "Sign in to Segra"
								: "Sign in"}
					</Button>
					{segraSignIn.signingIn ? (
						<Button
							disabled={segraSignIn.cancelling}
							onClick={() => void segraSignIn.cancelSignIn()}
							size="md"
							tone="neutral"
							type="button"
							variant="ghost"
						>
							Cancel
						</Button>
					) : null}
				</div>
				{segraSignIn.signingIn && segraUserCode ? (
					<p className="mt-4 ml-12 text-sm text-muted-foreground max-[720px]:ml-0">
						Confirm this code in your browser:{" "}
						<span className="font-mono font-medium text-foreground">
							{segraUserCode}
						</span>
					</p>
				) : null}
				{segraSignIn.error ? (
					<p
						className="mt-6 ml-12 text-xs text-destructive max-[720px]:ml-0"
						role="alert"
					>
						Sign in failed: {segraSignIn.error}
					</p>
				) : null}
			</div>

			<p className="mt-4 text-center text-xs text-muted-foreground">
				By signing in you agree to the{" "}
				<button
					className="underline underline-offset-2 hover:text-foreground"
					onClick={() => void openExternalUrl("https://web.segra.ai/terms")}
					type="button"
				>
					terms
				</button>{" "}
				and{" "}
				<button
					className="underline underline-offset-2 hover:text-foreground"
					onClick={() => void openExternalUrl("https://web.segra.ai/privacy")}
					type="button"
				>
					privacy policy
				</button>
				.
			</p>

			{localAvailable && recommended ? (
				<div
					className="mt-6 flex items-start gap-3 rounded-xl border border-border p-4 max-[720px]:flex-col"
					data-onboarding-option="local"
				>
					<span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground/4 text-muted-foreground">
						<HardDrive className="size-4" />
					</span>
					<div className="min-w-0 flex-1">
						<h4 className="text-sm font-semibold text-foreground">
							Or run it on this computer
						</h4>
						<p className="mt-1 text-xs text-muted-foreground">
							{LOCAL_ONLY_NOTE}{" "}
							{recommended.downloaded
								? `${recommended.name} is already on this computer.`
								: `Downloads ${recommended.name} (${formatBytes(recommended.bytes)}).`}
						</p>
					</div>
					<Button
						className="shrink-0"
						disabled={startingLocal || segraSignIn.signingIn}
						onClick={() => void useThisComputer()}
						size="sm"
						tone="neutral"
						type="button"
						variant="surface"
					>
						{startingLocal && <Loader2 className="size-4 animate-spin" />}
						Use this computer
					</Button>
				</div>
			) : null}

			<div className="mt-5 flex justify-center">
				<Button
					onClick={onSkip}
					size="sm"
					tone="neutral"
					type="button"
					variant="ghost"
				>
					Skip
				</Button>
			</div>
		</OnboardingContent>
	);
}

/**
 * Offers to bring session history over from other coding tools. Scans once
 * on entry and silently advances when there is nothing to import, so only
 * people who actually have Claude Code / Codex / opencode history ever see
 * this step. After a successful import, onFinish closes onboarding directly
 * — a second "you're all set" screen right after the import confirmation
 * reads as a loop, not a finish.
 */
function ImportHistoryStep({
	onContinue,
	onFinish,
}: {
	onContinue: () => void;
	onFinish: () => void;
}) {
	const [found, setFound] = useState<{
		count: number;
		tools: SessionImportTool[];
	} | null>(null);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [imported, setImported] = useState(false);

	// The parent recreates onContinue every render, and importing itself
	// re-renders the app shell (history refresh). Keep the callback in a ref
	// so the scan effect runs exactly once per step entry: a re-scan after
	// importing would see zero remaining sessions and auto-advance out from
	// under the user's own import confirmation.
	const skipRef = useRef(onContinue);
	useEffect(() => {
		skipRef.current = onContinue;
	});

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const response =
					await desktopClient.invoke<ListImportableSessionsResponse>(
						"list_importable_sessions",
						{},
						{ timeoutMs: 120_000 },
					);
				if (cancelled) return;
				const sessions = (response.sessions ?? []).filter(
					(session) => !session.alreadyImportedSessionId,
				);
				if (sessions.length === 0) {
					skipRef.current();
					return;
				}
				const tools = SESSION_IMPORT_TOOL_ORDER.filter((tool) =>
					sessions.some((session) => session.tool === tool),
				);
				setFound({ count: sessions.length, tools });
			} catch {
				// Onboarding must never dead-end on a scan failure.
				if (!cancelled) skipRef.current();
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	if (!found) {
		return (
			<OnboardingContent surface="transparent">
				<div className="flex flex-col items-center py-10 text-center">
					<Loader2
						aria-hidden="true"
						className="size-6 animate-spin text-muted-foreground"
					/>
					<p className="mt-4 text-md text-muted-foreground">
						Checking for session history from other tools…
					</p>
					<Button
						className="mt-8"
						onClick={onContinue}
						size="sm"
						type="button"
						variant="ghost"
					>
						Skip
					</Button>
				</div>
			</OnboardingContent>
		);
	}

	const toolList = found.tools
		.map((tool) => SESSION_IMPORT_TOOL_LABELS[tool])
		.join(found.tools.length === 2 ? " and " : ", ");

	return (
		<OnboardingContent surface="transparent">
			<div className="flex flex-col items-center py-4 text-center">
				<Import aria-hidden="true" className="size-10 text-primary" />
				<h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">
					Bring your history with you
				</h1>
				<p className="mt-3 text-md text-muted-foreground">
					{imported
						? "Your sessions are in Segra Desktop's history now. You can import more anytime from the Sessions page."
						: `Segra Desktop found ${found.count} session${found.count === 1 ? "" : "s"} from ${toolList} on this machine. Import them to keep your past conversations — and continue them here.`}
				</p>
				{imported ? (
					<Button
						className="mt-8 w-full max-w-64"
						onClick={onFinish}
						size="lg"
						tone="accent"
						type="button"
						variant="fill"
					>
						Start building
					</Button>
				) : (
					<>
						<Button
							className="mt-8 w-full max-w-64"
							onClick={() => setDialogOpen(true)}
							size="lg"
							tone="accent"
							type="button"
							variant="fill"
						>
							Choose sessions to import
						</Button>
						<Button
							className="mt-3"
							onClick={onContinue}
							size="sm"
							type="button"
							variant="ghost"
						>
							Skip for now
						</Button>
					</>
				)}
				<ImportSessionsDialog
					onImported={() => setImported(true)}
					onOpenChange={setDialogOpen}
					open={dialogOpen}
				/>
			</div>
		</OnboardingContent>
	);
}

function DoneStep({
	connection,
	onFinish,
}: {
	connection: OnboardingConnection | null;
	onFinish: () => void;
}) {
	return (
		<OnboardingContent surface="transparent">
			<div className="flex flex-col items-center py-4 text-center">
				<CheckCircle2 aria-hidden="true" className="size-10 text-primary" />
				<h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">
					You&apos;re all set
				</h1>
				{connection ? (
					<p className="mt-3 text-md text-muted-foreground">
						{connection.message ?? `${connection.providerName} is connected.`}
					</p>
				) : null}
				<Button
					className="mt-8 w-full max-w-64"
					onClick={onFinish}
					size="lg"
					tone="accent"
					type="button"
					variant="fill"
				>
					Start building
				</Button>
			</div>
		</OnboardingContent>
	);
}

export function OnboardingView({
	onComplete,
	initialStep = "welcome",
}: {
	onComplete: () => void;
	initialStep?: OnboardingStep;
}) {
	const [step, setStep] = useState<OnboardingStep>(initialStep);
	const [connection, setConnection] = useState<OnboardingConnection | null>(
		null,
	);

	return (
		<div className="relative h-full w-full overflow-y-auto bg-background">
			<div className="relative flex min-h-full w-full items-center justify-center overflow-hidden p-6">
				<div
					className={
						step === "done"
							? "pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2"
							: "pointer-events-none absolute inset-0"
					}
					data-onboarding-grid={step}
				>
					<AgentWelcomeHero
						interactive={step !== "done"}
						layout={step === "done" ? "wide-grid" : "full-bleed"}
						variant="grid-only"
					/>
				</div>
				{step === "welcome" ? (
					<WelcomeStep onContinue={() => setStep("connect")} />
				) : step === "connect" ? (
					<ConnectStep
						onBack={() => setStep("welcome")}
						onConnected={(nextConnection) => {
							setConnection(nextConnection);
							setStep("import");
						}}
						onSkip={onComplete}
					/>
				) : step === "import" ? (
					<ImportHistoryStep
						onContinue={() => setStep("done")}
						onFinish={onComplete}
					/>
				) : (
					<DoneStep connection={connection} onFinish={onComplete} />
				)}
			</div>
		</div>
	);
}
