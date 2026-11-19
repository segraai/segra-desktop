// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkBlock } from "./work-block";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	vi.useFakeTimers();
	vi.setSystemTime(100_000);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
});

const label = () =>
	container.querySelector(".cline-chat-tool-label")?.textContent;

describe("WorkBlock", () => {
	it("keeps the finished label without live", async () => {
		await act(async () =>
			root.render(
				<WorkBlock durationMilliseconds={4_000} toolCallCount={2}>
					rows
				</WorkBlock>,
			),
		);
		expect(label()).toBe("Worked for 4s and made 2 tool calls");
	});

	it("ticks the live label and stops the interval on unmount", async () => {
		await act(async () =>
			root.render(
				<WorkBlock
					defaultOpen={false}
					live={{ startTimestamp: 100_000 - 5_000, latestStep: "Thinking" }}
					toolCallCount={1}
				>
					rows
				</WorkBlock>,
			),
		);
		expect(label()).toBe("Working for 5s · 1 step · Thinking");
		await act(async () => {
			vi.advanceTimersByTime(3_000);
		});
		expect(label()).toBe("Working for 8s · 1 step · Thinking");
		expect(vi.getTimerCount()).toBe(1);
		await act(async () => root.unmount());
		expect(vi.getTimerCount()).toBe(0);
		root = createRoot(container);
	});

	it("omits unknown parts", async () => {
		await act(async () =>
			root.render(
				<WorkBlock live={{}} toolCallCount={0}>
					rows
				</WorkBlock>,
			),
		);
		expect(label()).toBe("Working");
	});
});
