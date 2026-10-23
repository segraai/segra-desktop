import { CLINE_DEFAULT_MODEL_ID } from "@cline/shared/browser";
import type { ChatSessionConfig } from "@/lib/chat-schema";
import {
	type ExecutionTarget,
	readExecutionTargetFromWindow,
	readModelSelectionStorageFromWindow,
} from "@/lib/model-selection";
import { normalizeProviderId } from "@/lib/provider-id";
import { startsAsChat } from "@/lib/segra-chat-default";
import {
	LOCAL_WORKSPACE_ENVIRONMENT_ID,
	readWorkspaceSelectionFromWindow,
} from "@/lib/workspace-paths";

export const CHAT_TRANSPORT_UNAVAILABLE_MESSAGE =
	"Chat connection is unavailable. Reopen the app window to restore realtime chat.";
export const CHAT_WS_ENDPOINT_RETRY_ATTEMPTS = 60;
export const CHAT_WS_ENDPOINT_RETRY_DELAY_MS = 100;
export const CHAT_WS_RECONNECT_BASE_DELAY_MS = 300;
export const CHAT_WS_RECONNECT_MAX_DELAY_MS = 3000;
export const CHAT_WS_REQUEST_TIMEOUT_MS = 120000;
export { OAUTH_PROVIDER_IDS as OAUTH_MANAGED_PROVIDERS } from "@/lib/provider-connection";

export const SEGRA_DEFAULT_MODEL_ID = "0GM-1.0-35B-A3B";

export const DEFAULT_CHAT_CONFIG: ChatSessionConfig = {
	sessionId: undefined,
	executionTarget: "local",
	repoUrl: undefined,
	workspaceRoot: "",
	cwd: "",
	environmentId: LOCAL_WORKSPACE_ENVIRONMENT_ID,
	// Segra Desktop: new installs start on Segra's default model. If Segra stops
	// listing it, the composer switches to the first model it does list.
	provider: "segra",
	model: SEGRA_DEFAULT_MODEL_ID,
	apiKey: "",
	mode: "act",
	systemPrompt: undefined,
	maxIterations: undefined,
	thinking: undefined,
	reasoningEffort: undefined,
	enableTools: true,
	autoApproveTools: true,
	missionStepInterval: undefined,
	missionTimeIntervalMs: undefined,
};

export function getInitialChatConfig(
	environmentId: string,
	options?: { executionTarget?: ExecutionTarget },
): ChatSessionConfig {
	const selection = readModelSelectionStorageFromWindow();
	const workspaceSelection = readWorkspaceSelectionFromWindow(environmentId);
	const rememberedProvider = normalizeProviderId(selection.lastProvider);
	const rememberedModelForProvider = rememberedProvider
		? (selection.lastModelByProvider[rememberedProvider] ??
			selection.lastModelByProvider[selection.lastProvider.trim()])
		: undefined;
	const rememberedModelForDefaultProvider =
		selection.lastModelByProvider[DEFAULT_CHAT_CONFIG.provider];
	const provider = rememberedProvider || DEFAULT_CHAT_CONFIG.provider;
	const model =
		rememberedModelForProvider ||
		(provider === DEFAULT_CHAT_CONFIG.provider
			? rememberedModelForDefaultProvider
			: undefined) ||
		DEFAULT_CHAT_CONFIG.model;

	// Segra Desktop: new local sessions start as a plain chat (no folder).
	const startFolder = startsAsChat(environmentId)
		? ""
		: workspaceSelection.lastWorkspace;
	const local: ChatSessionConfig = {
		...DEFAULT_CHAT_CONFIG,
		environmentId,
		provider,
		model,
		workspaceRoot: startFolder,
		cwd: startFolder,
	};
	// Cloud preferences apply only to the local environment.
	const executionTarget =
		options?.executionTarget ??
		(environmentId === LOCAL_WORKSPACE_ENVIRONMENT_ID
			? readExecutionTargetFromWindow()
			: "local");
	if (executionTarget !== "cloud") {
		return local;
	}
	return {
		...local,
		executionTarget: "cloud",
		provider: DEFAULT_CHAT_CONFIG.provider,
		model:
			readModelSelectionStorageFromWindow("cloud").lastModelByProvider.cline ||
			(provider === DEFAULT_CHAT_CONFIG.provider
				? model
				: DEFAULT_CHAT_CONFIG.model),
		workspaceRoot: "",
		cwd: "",
	};
}
