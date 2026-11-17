import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ProviderSettingsManager } from "@cline/core";
import { describe, expect, it, vi } from "vitest";
import {
	createOAuthCallbacks,
	getPersistedProviderApiKey,
	isOAuthProvider,
	normalizeAuthProviderId,
	parseAuthCommandArgs,
	runAuthProviderCommand,
	saveOAuthProviderSettings,
} from "./auth";

describe("parseAuthCommandArgs", () => {
	it("parses Azure API version quick setup option", () => {
		expect(
			parseAuthCommandArgs([
				"--provider",
				"openai-compatible",
				"--apikey",
				"key",
				"--modelid",
				"gpt-4.1",
				"--baseurl",
				"https://example.openai.azure.com/openai/deployments/gpt-4.1",
				"--azure-api-version",
				"2025-01-01-preview",
			]),
		).toMatchObject({
			explicitProvider: "openai-compatible",
			apikey: "key",
			modelid: "gpt-4.1",
			baseurl: "https://example.openai.azure.com/openai/deployments/gpt-4.1",
			azureApiVersion: "2025-01-01-preview",
		});
	});
});

describe("saveOAuthProviderSettings", () => {
	it("preserves existing manual apiKey while updating OAuth tokens", () => {
		const save = vi.fn();
		const manager = {
			saveProviderSettings: save,
		} as unknown as ProviderSettingsManager;

		const merged = saveOAuthProviderSettings(
			manager,
			"cline",
			{
				provider: "cline",
				apiKey: "manual-key",
				auth: {
					accessToken: "workos:old-access",
					refreshToken: "old-refresh",
					accountId: "acct-old",
				},
			},
			{
				access: "new-access",
				refresh: "new-refresh",
				expires: 4_000_000_000_000,
				accountId: "acct-new",
			},
		);

		expect(merged).toMatchObject({
			provider: "cline",
			apiKey: "manual-key",
			auth: {
				accessToken: "workos:new-access",
				refreshToken: "new-refresh",
				accountId: "acct-new",
				expiresAt: 4_000_000_000_000,
			},
		});
		expect(save).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "cline",
				apiKey: "manual-key",
				auth: expect.objectContaining({
					accessToken: "workos:new-access",
				}),
			}),
			{ tokenSource: "oauth" },
		);
	});
});

describe("getPersistedProviderApiKey", () => {
	it("does not double-prefix persisted Cline OAuth tokens", () => {
		expect(
			getPersistedProviderApiKey("cline", {
				provider: "cline",
				auth: {
					accessToken: "workos:oauth-access",
				},
			}),
		).toBe("workos:oauth-access");
	});
});

describe("normalizeAuthProviderId", () => {
	it("keeps CLI-only codex shorthand in CLI parsing", () => {
		expect(normalizeAuthProviderId("codex")).toBe("openai-codex");
	});
});

describe("segra sign-in", () => {
	it("normalizes casing and whitespace and is an OAuth provider", () => {
		expect(normalizeAuthProviderId("  Segra ")).toBe("segra");
		expect(isOAuthProvider("segra")).toBe(true);
	});

	it("lists segra in the unsupported-provider error", async () => {
		const writeErr = vi.fn();
		const code = await runAuthProviderCommand(
			{} as unknown as ProviderSettingsManager,
			"anthropic",
			{ writeln: vi.fn(), writeErr },
		);
		expect(code).toBe(1);
		expect(writeErr.mock.calls[0][0]).toContain("segra");
	});

	it("prints the confirmation code instructions and URL", () => {
		const lines: string[] = [];
		const callbacks = createOAuthCallbacks({
			writeln: (text) => lines.push(text ?? ""),
			writeErr: vi.fn(),
		});
		callbacks.onAuth({
			url: "http://127.0.0.1:9/device?code=ABCD-1234",
			instructions:
				"Confirm the code ABCD-1234 in your browser to sign in to Segra.",
		});
		const out = lines.join("\n");
		expect(out).toContain("ABCD-1234 in your browser");
		expect(out).toContain("http://127.0.0.1:9/device?code=ABCD-1234");
	});
});

describe("loadAuthTuiRuntime", () => {
	it("loads OpenTUI React after provider catalog initialization", async () => {
		const cliRoot = fileURLToPath(new URL("../..", import.meta.url));
		const script = `
import { ProviderSettingsManager, ensureCustomProvidersLoaded, listLocalProviders } from "@cline/core";
import { loadAuthTuiRuntime } from "./src/commands/auth.ts";
const manager = new ProviderSettingsManager();
await ensureCustomProvidersLoaded(manager);
await listLocalProviders(manager);
const runtime = await loadAuthTuiRuntime();
if (typeof runtime.createCliRenderer !== "function") throw new Error("missing createCliRenderer");
if (typeof runtime.createRoot !== "function") throw new Error("missing createRoot");
if (typeof runtime.OnboardingView !== "function") throw new Error("missing OnboardingView");
`;

		const result = spawnSync(
			"bun",
			["--conditions=development", "-e", script],
			{
				cwd: cliRoot,
				encoding: "utf8",
			},
		);

		expect(result.error).toBeUndefined();
		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
	});
});
