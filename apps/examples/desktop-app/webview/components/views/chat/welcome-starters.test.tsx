// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WELCOME_STARTERS } from "@/lib/welcome-starters";
import { WelcomeStarters } from "./welcome-starters";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("WelcomeStarters", () => {
	it("renders four real buttons, one per starter", () => {
		act(() => root.render(<WelcomeStarters onSelect={vi.fn()} />));
		const buttons = container.querySelectorAll("button[type='button']");
		expect(buttons).toHaveLength(4);
		for (const starter of WELCOME_STARTERS) {
			expect(container.textContent).toContain(starter.title);
			expect(container.textContent).toContain(starter.description);
		}
	});

	it("passes the prompt to onSelect when clicked", async () => {
		const onSelect = vi.fn();
		act(() => root.render(<WelcomeStarters onSelect={onSelect} />));
		const first = container.querySelector<HTMLButtonElement>("button");
		await act(async () => first?.click());
		expect(onSelect).toHaveBeenCalledOnce();
		expect(onSelect.mock.calls[0]?.[0]).toBe(WELCOME_STARTERS[0]?.prompt);
	});

	it("points the prompts at the document and workbook tools", () => {
		const prompts = WELCOME_STARTERS.map((starter) => starter.prompt);
		expect(prompts[0]).toContain("read_document");
		expect(prompts[0]).toContain("write_workbook");
		expect(prompts[1]).toContain("read_document");
		expect(prompts[3]).toContain("read_document");
		expect(new Set(WELCOME_STARTERS.map((s) => s.id)).size).toBe(4);
	});
});
