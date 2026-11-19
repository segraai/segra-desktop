"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import "./robot-dancer.css";

const DANCES = ["classic", "pop", "walk", "wave", "mime"] as const;
// Two loops of the 1.6s dances (one loop of the 3.2s slow mime).
const DANCE_MS = 3200;

const line = (y1: number, y2: number) => (
	<line x1="12" y1={y1} x2="12" y2={y2} />
);

function Arm({ side }: { side: "l" | "r" }) {
	return (
		<g className={`arm-${side}`}>
			<g className="ua">
				{line(9, 12)}
				<g className="fa">{line(12, 15)}</g>
			</g>
		</g>
	);
}

function Leg({ side }: { side: "l" | "r" }) {
	return (
		<g className={`leg-${side}`}>
			<g className="th">
				{line(14.5, 18)}
				<g className="sh">{line(18, 21.5)}</g>
			</g>
		</g>
	);
}

/** Tiny stick-figure robot that cycles through five dances; Normal-mode "working" indicator. */
export function RobotDancer({ className }: { className?: string }) {
	const [index, setIndex] = useState(0);
	useEffect(() => {
		if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
			return;
		}
		const id = setInterval(
			() => setIndex((i) => (i + 1) % DANCES.length),
			DANCE_MS,
		);
		return () => clearInterval(id);
	}, []);
	return (
		<svg
			aria-hidden="true"
			className={cn("robot-dancer", DANCES[index], "size-5", className)}
			viewBox="0 0 24 24"
		>
			<g className="whole">
				<g className="legs">
					<Leg side="l" />
					<Leg side="r" />
				</g>
				<g className="torso">
					{line(7.3, 14.5)}
					<g className="headg">
						<circle className="skull" cx="12" cy="4.6" r="2.7" />
					</g>
					<Arm side="l" />
					<Arm side="r" />
				</g>
			</g>
		</svg>
	);
}
