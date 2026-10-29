"use client";

import { Download, HardDrive, Loader2 } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
	cancelLocalModelDownload,
	downloadPercent,
	formatBytes,
	type LocalModelsState,
	startLocalModelDownload,
} from "@/lib/local-models";
import { LOCAL_PROMISE, SEGRA_ONE_LINER } from "@/lib/privacy";

/**
 * Shown above the composer on a new chat with a local model: getting the
 * model ready, or once it's here, what that means for their privacy. Segra
 * is offered underneath for people who want bigger models.
 */
export function WelcomeLocalNotice({
	state,
	modelId,
	onUseModel,
	onUseSegra,
}: {
	state: LocalModelsState;
	modelId: string;
	/** Points the chat at a local model (the one downloaded here). */
	onUseModel: (modelId: string) => void;
	onUseSegra?: () => void;
}) {
	// The chat's model when it's here or on its way; otherwise the one
	// recommended for this computer.
	const selected = state.models.find((entry) => entry.id === modelId);
	const model =
		selected && (selected.downloaded || selected.download)
			? selected
			: (state.models.find((entry) => entry.id === state.recommendedId) ??
				selected);
	const modelReady = Boolean(model?.downloaded);
	const shownId = model?.id;
	useEffect(() => {
		if (modelReady && shownId && shownId !== modelId) onUseModel(shownId);
	}, [modelId, modelReady, onUseModel, shownId]);
	if (!model) return null;
	const download = model.download;
	const downloading =
		download?.status === "downloading" || download?.status === "verifying";

	if (model.downloaded) {
		return (
			<p className="mt-6 flex items-start gap-2 px-1 text-[13px] text-muted-foreground">
				<HardDrive
					aria-hidden="true"
					className="mt-0.5 size-4 shrink-0 text-primary"
				/>
				<span>
					{LOCAL_PROMISE}{" "}
					{onUseSegra ? (
						<>
							Local models are smaller; for big coding tasks,{" "}
							<button
								className="font-medium text-primary hover:underline"
								onClick={onUseSegra}
								type="button"
							>
								try a Segra model
							</button>
							.
						</>
					) : null}
				</span>
			</p>
		);
	}

	return (
		<output className="mt-6 block rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 backdrop-blur-sm">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex min-w-0 items-start gap-3">
					<span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
						{downloading ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<HardDrive className="size-4" />
						)}
					</span>
					<div className="min-w-0">
						<p className="text-sm font-semibold text-foreground">
							{downloading
								? `Getting ${model.name} ready on this computer`
								: "Run AI on this computer"}
						</p>
						<p className="mt-0.5 text-[13px] text-muted-foreground">
							{downloading && download
								? download.status === "verifying"
									? "Checking the download…"
									: `${formatBytes(download.receivedBytes)} of ${formatBytes(download.totalBytes)}. You can close this window; it keeps going.`
								: `Download ${model.name} once (${formatBytes(model.bytes)}). After that, nothing you type leaves this computer.`}
						</p>
						{download?.status === "error" ? (
							<p className="mt-1 text-[13px] text-destructive" role="alert">
								{download.error}
							</p>
						) : null}
					</div>
				</div>
				{downloading ? (
					<Button
						className="rounded-full"
						onClick={() => void cancelLocalModelDownload(model.id)}
						size="sm"
						type="button"
						variant="ghost"
					>
						Cancel
					</Button>
				) : (
					<Button
						className="rounded-full"
						onClick={() => {
							onUseModel(model.id);
							void startLocalModelDownload(model.id);
						}}
						size="sm"
						type="button"
					>
						<Download className="size-4" />
						{download?.status === "error" ? "Try again" : "Download"}
					</Button>
				)}
			</div>
			{downloading && download ? (
				<div
					aria-label={`Downloading ${model.name}`}
					aria-valuenow={downloadPercent(download)}
					className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
					role="progressbar"
				>
					<div
						className="h-full bg-primary transition-[width]"
						style={{ width: `${downloadPercent(download)}%` }}
					/>
				</div>
			) : null}
			{onUseSegra ? (
				<p className="mt-3 border-t border-primary/15 pt-3 text-[13px] text-muted-foreground">
					{SEGRA_ONE_LINER}{" "}
					<button
						className="font-medium text-primary hover:underline"
						onClick={onUseSegra}
						type="button"
					>
						Sign in to Segra
					</button>
				</p>
			) : null}
		</output>
	);
}
