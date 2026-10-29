"use client";

import { useCallback, useEffect, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";
import { invalidateProviderCatalogCache } from "@/lib/provider-model-catalog";

/** Built-in local models (sidecar/local-models.ts, catalog in @cline/llms). */
export const SEGRA_LOCAL_PROVIDER_ID = "segra-local";

export type LocalModelDownload = {
	modelId: string;
	status: "downloading" | "verifying" | "done" | "error" | "cancelled";
	receivedBytes: number;
	totalBytes: number;
	error?: string;
};

export type LocalModel = {
	id: string;
	name: string;
	description: string;
	tier: "fast" | "balanced" | "best";
	bytes: number;
	contextWindow: number;
	minMemoryGb: number;
	downloaded: boolean;
	download: LocalModelDownload | null;
};

export type LocalModelsState = {
	models: LocalModel[];
	recommendedId: string;
	memoryBytes: number;
	engine: {
		/** False for builds without the bundled llama.cpp server. */
		available: boolean;
		running: boolean;
		modelId: string | null;
		baseUrl: string | null;
	};
};

export function formatBytes(bytes: number): string {
	const gb = bytes / 1024 ** 3;
	if (gb >= 1) return `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB`;
	return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

export function downloadPercent(download: LocalModelDownload): number {
	if (!download.totalBytes) return 0;
	return Math.min(
		100,
		Math.floor((download.receivedBytes / download.totalBytes) * 100),
	);
}

/** Also sets the provider up, so the composer can select it right away. */
export function startLocalModelDownload(modelId: string) {
	return desktopClient
		.invoke("local_model_download", { model: modelId })
		.then((result) => {
			invalidateProviderCatalogCache();
			return result;
		});
}

export function cancelLocalModelDownload(modelId: string) {
	return desktopClient.invoke("local_model_cancel", { model: modelId });
}

export function deleteLocalModel(modelId: string) {
	return desktopClient.invoke<{ deleted: boolean }>("local_model_delete", {
		model: modelId,
	});
}

/**
 * The local models and their downloads, kept live from the sidecar's
 * `local_model_progress` events. A finished download sets the provider up,
 * so it also refreshes the provider catalog (the composer's picker).
 */
export function useLocalModels(active = true) {
	const [state, setState] = useState<LocalModelsState | null>(null);

	const refresh = useCallback(() => {
		desktopClient
			.invoke<LocalModelsState>("local_models_list")
			.then((next) => {
				if (next?.models) setState(next);
			})
			.catch(() => undefined);
	}, []);

	useEffect(() => {
		if (!active) return;
		refresh();
		const unsubscribers = [
			desktopClient.subscribe("local_model_progress", (payload) => {
				const download = payload as LocalModelDownload | null;
				if (!download?.modelId) return;
				setState((current) =>
					current
						? {
								...current,
								models: current.models.map((model) =>
									model.id === download.modelId
										? {
												...model,
												downloaded:
													model.downloaded || download.status === "done",
												download: download.status === "done" ? null : download,
											}
										: model,
								),
							}
						: current,
				);
				if (download.status === "done") {
					invalidateProviderCatalogCache();
					refresh();
				}
			}),
			desktopClient.subscribeTransportState((transport) => {
				if (transport === "connected") refresh();
			}),
		];
		return () => {
			for (const unsubscribe of unsubscribers) unsubscribe();
		};
	}, [active, refresh]);

	return { state, refresh };
}
