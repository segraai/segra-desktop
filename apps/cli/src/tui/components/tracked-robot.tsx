import { useCallback, useRef, useState } from "react";
import { useTheme } from "../hooks/use-theme";

export function useMouseTracker() {
	const [cursor, setCursor] = useState({ x: 0, y: 0 });
	const lastUpdateRef = useRef(0);

	const onMouseMove = useCallback((event: { x: number; y: number }) => {
		const now = Date.now();
		if (now - lastUpdateRef.current < 30) return;
		lastUpdateRef.current = now;
		setCursor({ x: event.x, y: event.y });
	}, []);

	return { cursor, onMouseMove };
}

const WORDMARK = [
	"▄▄▄▄ ▄▄▄▄ ▄▄▄▄ ▄▄▄▄ ▄▄▄▄",
	"█▄▄▄ █▄▄  █ ▄▄ █▄▄▀ █▄▄█",
	"▄▄▄█ █▄▄▄ █▄▄█ █ ▀▄ █  █",
];

/**
 * Segra wordmark shown on the home and onboarding screens. The cursor props are
 * accepted for call-site compatibility but the mark is static.
 */
export function TrackedRobot(_props: { cursorX?: number; cursorY?: number }) {
	const defaultFg = useTheme().defaultForeground;
	return (
		<box
			width="100%"
			flexShrink={1}
			overflow="hidden"
			flexDirection="column"
			alignItems="center"
		>
			{WORDMARK.map((row) => (
				<text key={row} fg={defaultFg}>
					{row}
				</text>
			))}
		</box>
	);
}
