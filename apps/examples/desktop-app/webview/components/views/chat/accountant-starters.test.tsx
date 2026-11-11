// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNTANT_STARTERS } from "@/lib/accountant-starters";
import { AccountantStarters } from "./accountant-starters";

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

describe("AccountantStarters", () => {
	it("renders four real buttons, one per starter", () => {
		act(() => root.render(<AccountantStarters onSelect={vi.fn()} />));
		const buttons = container.querySelectorAll("button[type='button']");
		expect(buttons).toHaveLength(4);
		for (const starter of ACCOUNTANT_STARTERS) {
			expect(container.textContent).toContain(starter.title);
			expect(container.textContent).toContain(starter.description);
		}
	});

	it("passes the prompt to onSelect when clicked", async () => {
		const onSelect = vi.fn();
		act(() => root.render(<AccountantStarters onSelect={onSelect} />));
		const first = container.querySelector<HTMLButtonElement>("button");
		await act(async () => first?.click());
		expect(onSelect).toHaveBeenCalledOnce();
		expect(onSelect.mock.calls[0]?.[0]).toBe(ACCOUNTANT_STARTERS[0]?.prompt);
	});

	it("points the prompts at the document and workbook tools", () => {
		const prompts = ACCOUNTANT_STARTERS.map((starter) => starter.prompt);
		expect(prompts[0]).toContain("read_document");
		expect(prompts[0]).toContain("write_workbook");
		expect(prompts[1]).toContain("read_document");
		expect(prompts[3]).toContain("read_document");
		expect(new Set(ACCOUNTANT_STARTERS.map((s) => s.id)).size).toBe(4);
	});
});
