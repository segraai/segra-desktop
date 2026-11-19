// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RobotDancer } from "./robot-dancer";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const mockReduce = (matches: boolean) =>
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({ matches })),
	);

const svg = () => container.querySelector("svg.robot-dancer");

beforeEach(() => {
	vi.useFakeTimers();
	mockReduce(false);
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("RobotDancer", () => {
	it("starts on classic and moves to pop after 3.2s", () => {
		act(() => root.render(<RobotDancer />));
		expect(svg()?.classList.contains("classic")).toBe(true);
		act(() => vi.advanceTimersByTime(3200));
		expect(svg()?.classList.contains("pop")).toBe(true);
	});

	it("does not cycle under reduced motion", () => {
		mockReduce(true);
		act(() => root.render(<RobotDancer />));
		act(() => vi.advanceTimersByTime(20_000));
		expect(svg()?.classList.contains("classic")).toBe(true);
	});

	it("clears its interval on unmount", () => {
		act(() => root.render(<RobotDancer />));
		expect(vi.getTimerCount()).toBe(1);
		act(() => root.unmount());
		expect(vi.getTimerCount()).toBe(0);
		root = createRoot(container);
	});
});
