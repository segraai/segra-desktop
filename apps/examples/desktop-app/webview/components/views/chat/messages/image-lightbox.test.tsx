// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatImageLightbox } from "./image-lightbox";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({ desktopClient: { invoke } }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

const image = { id: "img_1", mediaType: "image/png" as const, data: "AAAA" };

describe("ChatImageLightbox", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		invoke
			.mockReset()
			.mockResolvedValue({ path: "/tmp/image.png", fallback: false });
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	it("covers the whole window, saves, and closes on Escape", async () => {
		const onClose = vi.fn();
		await act(async () => {
			root.render(<ChatImageLightbox image={image} onClose={onClose} />);
		});
		const dialog = document.body.querySelector('[role="dialog"]');
		// Rendered on <body>, outside the chat pane, fixed to the window.
		expect(container.contains(dialog)).toBe(false);
		expect(dialog?.className).toContain("fixed inset-0");

		const save = [...document.body.querySelectorAll("button")].find(
			(button) => button.textContent === "Save",
		);
		await act(async () => save?.click());
		expect(invoke).toHaveBeenCalledWith("save_image", {
			data: "AAAA",
			mediaType: "image/png",
			name: "image",
		});

		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		});
		expect(onClose).toHaveBeenCalled();
	});
});
