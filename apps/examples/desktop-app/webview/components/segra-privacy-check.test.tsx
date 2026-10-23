// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSegraPrivacyCheck } from "./segra-privacy-check";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({ desktopClient: { invoke } }));

let run: ((model: string) => Promise<boolean>) | undefined;
function Harness() {
	const check = useSegraPrivacyCheck();
	run = check.run;
	return <>{check.overlay}</>;
}

describe("useSegraPrivacyCheck", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(async () => {
		vi.useFakeTimers();
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		invoke.mockReset();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		await act(async () => root.render(<Harness />));
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		vi.useRealTimers();
	});

	async function start(model = "0GM") {
		let settled: boolean | undefined;
		await act(async () => {
			void run?.(model).then((ok) => {
				settled = ok;
			});
		});
		return () => settled;
	}

	it("shows the check, then the verified badge, then sends", async () => {
		invoke.mockResolvedValue({ attestation: { trusted: true, verdict: "ok" } });
		const result = await start();
		expect(invoke).toHaveBeenCalledWith("segra_check_provider", {
			model: "0GM",
		});
		expect(document.body.textContent).toContain("Verifying privacy…");
		await act(async () => vi.advanceTimersByTimeAsync(1_600));
		expect(document.body.textContent).toContain("Privacy verified");
		expect(result()).toBeUndefined();
		await act(async () => vi.advanceTimersByTimeAsync(1_000));
		expect(result()).toBe(true);
		expect(document.body.textContent).not.toContain("Privacy verified");
	});

	it("keeps the message unsent when the provider fails", async () => {
		invoke.mockResolvedValue({
			attestation: { trusted: false, verdict: "Failed: Where the model runs." },
		});
		const result = await start();
		await act(async () => vi.advanceTimersByTimeAsync(1_600));
		expect(result()).toBe(false);
		expect(document.body.textContent).toContain("Message not sent");
		expect(document.body.textContent).toContain(
			"Failed: Where the model runs.",
		);
		const back = [...document.querySelectorAll("button")].find(
			(b) => b.textContent === "Back to chat",
		);
		await act(async () => back?.click());
		expect(document.body.textContent).not.toContain("Message not sent");
	});

	it("sends without the overlay when no check could start", async () => {
		invoke.mockResolvedValue({ attestation: null, error: "not signed in" });
		const result = await start();
		expect(result()).toBe(true);
		expect(document.body.textContent).not.toContain("Verifying privacy");
	});
});
