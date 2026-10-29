import {
	ProviderSettingsManager,
	saveLocalProviderSettings,
} from "@cline/core";
import { SEGRA_LOCAL_PROVIDER_ID } from "@cline/llms";
import { broadcastEvent } from "./context";
import { LocalModels } from "./local-models";
import type { SidecarContext } from "./types";

// One per sidecar: it owns the loopback port and the engine process.
let localModels: LocalModels | null = null;
// False when the usual port was taken and the proxy moved.
let isDefaultPort = true;

/**
 * Keeps the "On this computer" provider pointed at the proxy. Only writes
 * once the provider is set up, or `modelId` sets it up (a download started,
 * so the composer can select it right away); an existing model choice is
 * never overwritten.
 */
async function syncLocalProviderSettings(
	baseUrl: string | null,
	isDefaultPort: boolean,
	modelId?: string,
): Promise<void> {
	const manager = new ProviderSettingsManager();
	const existing = manager.getProviderSettings(SEGRA_LOCAL_PROVIDER_ID);
	if (!existing && !modelId) return;
	const wantedBaseUrl = isDefaultPort || !baseUrl ? "" : baseUrl;
	const needsModel = Boolean(modelId && !existing?.model);
	if ((existing?.baseUrl ?? "") === wantedBaseUrl && !needsModel) return;
	await saveLocalProviderSettings(manager, {
		providerId: SEGRA_LOCAL_PROVIDER_ID,
		baseUrl: wantedBaseUrl,
		...(needsModel ? { model: modelId } : {}),
	});
}

export async function startLocalModels(ctx: SidecarContext): Promise<void> {
	localModels = new LocalModels({
		onEvent: (name, payload) => broadcastEvent(ctx, name, payload),
		onLog: (message, details) => ctx.logger?.log(message, details),
		onEndpoint: (baseUrl, isDefault) => {
			isDefaultPort = isDefault;
			void syncLocalProviderSettings(baseUrl, isDefault).catch((error) =>
				ctx.logger?.error?.("Failed to update local model address", { error }),
			);
		},
		// A model Segra Meetings already downloaded is ready at once.
		onDownloaded: (modelId) =>
			syncLocalProviderSettings(
				localModels?.baseUrl ?? null,
				isDefaultPort,
				modelId,
			),
	});
	await localModels.listen();
}

export async function stopLocalModels(): Promise<void> {
	await localModels?.dispose();
	localModels = null;
}

function requireLocalModels(): LocalModels {
	if (!localModels) throw new Error("Local models aren't available.");
	return localModels;
}

function modelArg(args?: Record<string, unknown>): string {
	const modelId = String(args?.model ?? "").trim();
	if (!modelId) throw new Error("model is required");
	return modelId;
}

export const LOCAL_MODEL_COMMANDS = new Set([
	"local_models_list",
	"local_model_download",
	"local_model_cancel",
	"local_model_delete",
]);

export async function handleLocalModelsCommand(
	command: string,
	args?: Record<string, unknown>,
): Promise<unknown> {
	const models = requireLocalModels();
	if (command === "local_models_list") return models.list();
	if (command === "local_model_download") {
		const modelId = modelArg(args);
		await syncLocalProviderSettings(models.baseUrl, isDefaultPort, modelId);
		// Downloads take minutes: answer now, report through
		// `local_model_progress` events.
		void models.download(modelId);
		return { started: true };
	}
	if (command === "local_model_cancel") {
		models.cancel(modelArg(args));
		return { cancelled: true };
	}
	if (command === "local_model_delete") {
		return await models.delete(modelArg(args));
	}
	throw new Error(`Unknown local models command: ${command}`);
}
