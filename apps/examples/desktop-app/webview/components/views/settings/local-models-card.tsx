"use client";

import { Download, HardDrive, Loader2, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	cancelLocalModelDownload,
	deleteLocalModel,
	downloadPercent,
	formatBytes,
	type LocalModel,
	startLocalModelDownload,
	useLocalModels,
} from "@/lib/local-models";
import { cn } from "@/lib/utils";

/**
 * Settings → Providers: the built-in models that run on this computer, with
 * three preselected sizes so there's no long list to choose from.
 */
export function LocalModelsCard() {
	const { state, refresh } = useLocalModels();
	if (!state?.engine.available) return null;
	const memoryGb = Math.round(state.memoryBytes / 1024 ** 3);
	return (
		<section
			aria-label="On this computer"
			className="mt-6 rounded-xl border p-5 first:mt-0"
		>
			<div className="flex items-start gap-4">
				<span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-foreground/4 text-muted-foreground">
					<HardDrive aria-hidden="true" className="size-6" />
				</span>
				<div className="min-w-0 flex-1">
					<h2 className="text-xl font-semibold text-foreground">
						On this computer
					</h2>
					<p className="mt-2 text-sm leading-6 text-foreground">
						The most private option: models run right here, nothing you type
						leaves this computer, and they work offline. But they're slow on
						most computers and give simpler answers, so start with the
						smallest.
					</p>
				</div>
			</div>
			<ul className="mt-4 divide-y rounded-lg border bg-background">
				{state.models.map((model) => (
					<LocalModelRow
						key={model.id}
						memoryGb={memoryGb}
						model={model}
						onChanged={refresh}
						recommended={model.id === state.recommendedId}
					/>
				))}
			</ul>
			<p className="mt-3 text-xs text-muted-foreground">
				This computer has {memoryGb} GB of memory. Models download once from
				Hugging Face and are shared with Segra Meetings, so deleting one here
				deletes it there too.
			</p>
		</section>
	);
}

function LocalModelRow({
	model,
	recommended,
	memoryGb,
	onChanged,
}: {
	model: LocalModel;
	recommended: boolean;
	memoryGb: number;
	onChanged: () => void;
}) {
	const [deleting, setDeleting] = useState(false);
	const download = model.download;
	const downloading =
		download?.status === "downloading" || download?.status === "verifying";
	const tooBig = memoryGb + 1.5 < model.minMemoryGb;
	return (
		<li className="flex flex-wrap items-center gap-3 px-4 py-3">
			<div className="min-w-0 flex-1">
				<p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
					{model.name}
					{recommended ? (
						<span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
							Recommended for this computer
						</span>
					) : null}
					{model.downloaded ? (
						<span className="text-xs font-normal text-muted-foreground">
							Downloaded
						</span>
					) : null}
				</p>
				<p
					className={cn(
						"mt-0.5 text-xs text-muted-foreground",
						tooBig && !model.downloaded && "text-amber-600 dark:text-amber-400",
					)}
				>
					{model.description} {formatBytes(model.bytes)}.
					{tooBig && !model.downloaded
						? " Likely too big for this computer."
						: ""}
				</p>
				{downloading && download ? (
					<div className="mt-2 flex items-center gap-2">
						<div
							aria-label={`Downloading ${model.name}`}
							aria-valuenow={downloadPercent(download)}
							className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
							role="progressbar"
						>
							<div
								className="h-full bg-primary transition-[width]"
								style={{ width: `${downloadPercent(download)}%` }}
							/>
						</div>
						<span className="shrink-0 text-xs tabular-nums text-muted-foreground">
							{download.status === "verifying"
								? "Checking…"
								: `${formatBytes(download.receivedBytes)} of ${formatBytes(download.totalBytes)}`}
						</span>
					</div>
				) : null}
				{download?.status === "error" ? (
					<p className="mt-1 text-xs text-destructive" role="alert">
						{download.error}
					</p>
				) : null}
			</div>
			{downloading ? (
				<Button
					className="h-8 px-3 text-sm"
					onClick={() => void cancelLocalModelDownload(model.id)}
					type="button"
					variant="ghost"
				>
					<X className="size-4" />
					Cancel
				</Button>
			) : model.downloaded ? (
				<Button
					aria-label={`Delete ${model.name}`}
					className="h-8 px-3 text-sm"
					disabled={deleting}
					onClick={() => {
						setDeleting(true);
						void deleteLocalModel(model.id).finally(() => {
							setDeleting(false);
							onChanged();
						});
					}}
					type="button"
					variant="ghost"
				>
					{deleting ? (
						<Loader2 className="size-4 animate-spin" />
					) : (
						<Trash2 className="size-4" />
					)}
					Delete
				</Button>
			) : (
				<Button
					className="h-8 px-3 text-sm"
					onClick={() => void startLocalModelDownload(model.id)}
					type="button"
					variant={recommended ? "default" : "outline"}
				>
					<Download className="size-4" />
					Download
				</Button>
			)}
		</li>
	);
}
