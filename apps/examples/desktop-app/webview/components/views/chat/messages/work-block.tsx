"use client";

import {
	formatWorkDuration,
	WorkActivity,
	WorkActivityContent,
	WorkActivityTrigger,
} from "@cline/ui/components/agent-chat";
import { ChevronDown } from "lucide-react";
import { memo, type ReactNode, useEffect, useState } from "react";

export type WorkBlockLive = {
	startTimestamp?: number;
	latestStep?: string;
};

/** "Working for 1m 12s · 8 steps · Reading T4.pdf", omitting unknown parts. */
function formatLiveLabel(
	live: WorkBlockLive,
	toolCallCount: number,
	now: number,
): string {
	const parts: string[] = [];
	const start = live.startTimestamp;
	parts.push(
		start !== undefined && Number.isFinite(start)
			? `Working for ${formatWorkDuration(Math.max(0, now - start))}`
			: "Working",
	);
	if (toolCallCount > 0) {
		parts.push(`${toolCallCount} ${toolCallCount === 1 ? "step" : "steps"}`);
	}
	if (live.latestStep) {
		parts.push(live.latestStep);
	}
	return parts.join(" · ");
}

function LiveTrigger({
	live,
	toolCallCount,
	leading,
}: {
	live: WorkBlockLive;
	toolCallCount: number;
	leading?: ReactNode;
}) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, []);
	return (
		<WorkActivityTrigger>
			{leading}
			<span className="cline-chat-tool-label">
				{formatLiveLabel(live, toolCallCount, now)}
			</span>
			<ChevronDown aria-hidden="true" className="cline-chat-disclosure-icon" />
		</WorkActivityTrigger>
	);
}

/**
 * Collapsed summary row for a run's working rows. Expanding re-shows the
 * run's normal chat rows (tool calls, thinking traces, narration) under the
 * shared disclosure rail. Collapse state lives in the ui primitive, so
 * keying this block by the work item's stable id preserves it across renders.
 * With `live`, the label counts up while the run is still working.
 */
export const WorkBlock = memo(function WorkBlock({
	defaultOpen,
	durationMilliseconds,
	live,
	leading,
	toolCallCount,
	children,
}: {
	defaultOpen?: boolean;
	durationMilliseconds?: number;
	live?: WorkBlockLive;
	/** Shown before the live label only (e.g. the dancing robot). */
	leading?: ReactNode;
	toolCallCount: number;
	children: ReactNode;
}) {
	return (
		<WorkActivity defaultOpen={defaultOpen}>
			{live ? (
				<LiveTrigger
					leading={leading}
					live={live}
					toolCallCount={toolCallCount}
				/>
			) : (
				<WorkActivityTrigger
					durationMilliseconds={durationMilliseconds}
					toolCallCount={toolCallCount}
				/>
			)}
			<WorkActivityContent>{children}</WorkActivityContent>
		</WorkActivity>
	);
});
