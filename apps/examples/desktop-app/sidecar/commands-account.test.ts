import { describe, expect, it, vi } from "vitest";
import { isClineAccountNotAuthenticatedResult } from "../webview/lib/cline-account-state";
import type { SidecarContext } from "./types";

const clineAccountServiceCtorMock = vi.hoisted(() => vi.fn());

vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		ClineAccountService: class {
			constructor(options: unknown) {
				clineAccountServiceCtorMock(options);
			}
		},
	};
});

describe("cline_account command", () => {
	it("always reports signed out and never calls Cline's account API", async () => {
		const { handleCommand } = await import("./commands");
		const ctx = {
			logger: { debug: vi.fn(), log: vi.fn(), error: vi.fn() },
			wsClients: new Set(),
			liveSessions: new Map(),
		} as unknown as SidecarContext;
		const result = await handleCommand(ctx, "cline_account", {
			action: "clineAccount",
			operation: "fetchMe",
		});
		expect(isClineAccountNotAuthenticatedResult(result)).toBe(true);
		expect(clineAccountServiceCtorMock).not.toHaveBeenCalled();
	});
});
