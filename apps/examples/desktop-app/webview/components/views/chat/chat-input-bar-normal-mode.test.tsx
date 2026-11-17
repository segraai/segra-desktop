// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceProvider } from "@/contexts/workspace-context";
import { ChatInputBar } from "./chat-input-bar";

vi.mock("./pull-request-bar", () => ({
	PullRequestBar: () => <div data-testid="pull-request-bar" />,
}));
vi.mock("@/lib/provider-model-catalog", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/provider-model-catalog")>()),
	loadProviderModelCatalog: vi.fn(async () => ({
		providers: [],
		enabledProviderIds: ["cline"],
		providerModels: { cline: ["test-model"] },
		providerReasoningModels: { cline: [] },
		voiceInput: null,
	})),
	loadProviderModels: vi.fn(async () => []),
	subscribeToProviderCatalogInvalidation: vi.fn(() => vi.fn()),
	subscribeToProviderModels: vi.fn(() => vi.fn()),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	HTMLElement.prototype.scrollIntoView = vi.fn();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	window.localStorage.removeItem("segra.app-mode.v1");
});

const workspaceValue = {
	workspaceRoot: "/workspace/client",
	workspaces: ["/workspace/client"],
	listWorkspaces: vi.fn(async () => ["/workspace/client"]),
	refreshWorkspaces: vi.fn(async () => undefined),
	switchWorkspace: vi.fn(async () => true),
	pickWorkspaceDirectory: vi.fn(async () => null),
	selectChat: vi.fn(async () => true),
};

async function renderBar(variant: "welcome" | "conversation" = "conversation") {
	await act(async () => {
		root.render(
			<WorkspaceProvider value={workspaceValue}>
				<ChatInputBar
					attachments={[]}
					gitBranch="main"
					hasRunningAgents={false}
					mode="act"
					model="test-model"
					onAbort={vi.fn()}
					onAttachFiles={vi.fn()}
					onEditPromptInQueue={vi.fn()}
					onListGitBranches={vi.fn(async () => ({
						current: "main",
						branches: ["main"],
					}))}
					onModeToggle={vi.fn()}
					onModelChange={vi.fn()}
					onPromptInputChange={vi.fn()}
					onProviderChange={vi.fn()}
					onReasoningChange={vi.fn()}
					onRemoveAttachment={vi.fn()}
					onRemovePromptInQueue={vi.fn()}
					onSend={vi.fn()}
					onSteerPromptInQueue={vi.fn()}
					onSwitchGitBranch={vi.fn(async () => true)}
					promptDraft={{ version: 0, value: "" }}
					promptsInQueue={[]}
					provider="cline"
					reasoningEffort="low"
					status="idle"
					summary={{ toolCalls: 0, tokensIn: 0, tokensOut: 0 }}
					thinking
					variant={variant}
				/>
			</WorkspaceProvider>,
		);
		await Promise.resolve();
	});
}

describe("ChatInputBar developer-only chrome", () => {
	it("renders the pull request bar in developer mode", async () => {
		window.localStorage.setItem("segra.app-mode.v1", "developer");
		await renderBar();
		expect(
			container.querySelector('[data-testid="pull-request-bar"]'),
		).not.toBeNull();
	});

	it("does not render the pull request bar in normal mode", async () => {
		window.localStorage.setItem("segra.app-mode.v1", "normal");
		await renderBar();
		expect(
			container.querySelector('[data-testid="pull-request-bar"]'),
		).toBeNull();
	});

	it("drops the #PR hint from the welcome placeholder in normal mode", async () => {
		window.localStorage.setItem("segra.app-mode.v1", "normal");
		await renderBar("welcome");
		const textarea = container.querySelector("textarea");
		expect(textarea?.getAttribute("placeholder")).not.toMatch(/PR/);
		window.localStorage.setItem("segra.app-mode.v1", "developer");
		await act(async () => {
			window.dispatchEvent(new Event("storage"));
		});
		expect(textarea?.getAttribute("placeholder")).toMatch(/#PRs/);
	});
});
