import type { LucideIcon } from "lucide-react";

/**
 * "What's new" catch-up highlights.
 *
 * Segra Desktop ships often, so individual releases are not
 * announced in-app; the About page always has the full changelog. Every so
 * often, once enough notable features have accumulated, we publish a catch-up
 * here and the app shows it once, as a dialog on the next launch.
 *
 * To publish a new catch-up:
 *
 * 1. Add an entry to the TOP of `WHATS_NEW_RELEASES`. Give it a new, stable
 *    `id` (date-prefixed, never reused): the app compares the latest id with
 *    the one the user last saw to decide whether to show the dialog.
 * 2. Give it a short title (a headline, not a sentence) and 3 or 4
 *    highlights. Lead with the user-facing capability, keep each description
 *    to one short sentence, and pick a lucide icon.
 * 3. Preview it from Settings → About → "Show what's new", which replays the
 *    latest entry without marking it seen.
 *
 * A launch big enough to carry the dialog alone can instead be a `spotlight`,
 * which `WhatsNewDialog` renders with its own layout and call to action.
 *
 * New installs never see a catch-up: onboarding marks the current entry as
 * seen, because everything is new to a first-time user anyway.
 */

export type WhatsNewHighlight = {
	title: string;
	description: string;
	icon: LucideIcon;
};

export type WhatsNewRelease =
	| { id: string; title: string; highlights: WhatsNewHighlight[] }
	| { id: string; title: string; spotlight: "connectors" };

// Segra Desktop release notes, newest first.
export const WHATS_NEW_RELEASES: WhatsNewRelease[] = [];
