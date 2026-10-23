// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SegraFeedbackDialog } from "./segra-feedback-dialog";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({ desktopClient: { invoke } }));

describe("SegraFeedbackDialog", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		Element.prototype.scrollTo = vi.fn();
		invoke.mockReset();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	it("shows sent messages and sends a new one", async () => {
		const sent = [{ id: 1, message: "Loving it", createdAt: 1 }];
		invoke.mockImplementation(
			async (_command: string, args: { action: string }) =>
				args.action === "list"
					? { signedIn: true, messages: sent }
					: { signedIn: true, sent: { id: 2 } },
		);
		await act(async () => {
			root.render(<SegraFeedbackDialog onOpenChange={vi.fn()} open />);
		});
		await act(async () => {});
		expect(document.body.textContent).toContain("Loving it");

		const box = document.querySelector<HTMLTextAreaElement>(
			'[aria-label="Feedback message"]',
		);
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				HTMLTextAreaElement.prototype,
				"value",
			)?.set;
			setter?.call(box, "The picker is slow");
			box?.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await act(async () => {
			document.querySelector<HTMLButtonElement>('[aria-label="Send"]')?.click();
		});
		expect(invoke).toHaveBeenCalledWith("segra_feedback", {
			action: "send",
			message: "The picker is slow",
		});
	});

	it("asks to sign in when there is no Segra account", async () => {
		invoke.mockResolvedValue({ signedIn: false, messages: [] });
		await act(async () => {
			root.render(<SegraFeedbackDialog onOpenChange={vi.fn()} open />);
		});
		await act(async () => {});
		expect(document.body.textContent).toContain("Sign in with Segra");
		expect(
			document.querySelector('[aria-label="Feedback message"]'),
		).toBeNull();
	});
});
