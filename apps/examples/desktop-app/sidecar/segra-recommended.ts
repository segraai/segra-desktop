// Plugins Segra recommends, shown in their own "Segra Recommended" section at
// the top of the Marketplace. They ship inside the app (Tauri resources
// `bin/segra-plugins/<name>`, from the repo's `plugins/<name>`), so installing
// one needs no network and always matches this app version.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Set by the Rust shell to `<resources>/bin/segra-plugins`. */
export const SEGRA_PLUGINS_DIR_ENV = "SEGRA_PLUGINS_DIR";

export type SegraRecommendedEntry = {
	id: string;
	type: "plugin";
	name: string;
	segraRecommended: true;
	tagline: string;
	description: string;
	tags: string[];
	author: { name: string; url?: string };
	homepage?: string;
	install: { args: string[]; command: string; notes?: string };
};

export const SEGRA_RECOMMENDED_ENTRIES: readonly SegraRecommendedEntry[] = [
	{
		id: "segra-claude-mem",
		type: "plugin",
		name: "claude-mem memory",
		segraRecommended: true,
		tagline: "Share your claude-mem memory with Segra.",
		description:
			"Records Segra sessions into claude-mem, adds relevant past work at the start of each run, and gives the agent claude-mem's search tools. Uses the same memory as Claude Code, so work from either app is remembered in both.",
		tags: ["memory", "productivity"],
		author: { name: "Segra" },
		homepage: "https://github.com/thedotmack/claude-mem",
		install: {
			// The plugin name: install resolves it to the bundled folder, and
			// uninstall removes the installed plugin by this name.
			args: ["segra-claude-mem"],
			command: "",
			notes:
				"Requires claude-mem, installed for Claude Code (https://github.com/thedotmack/claude-mem). Without it the plugin does nothing.",
		},
	},
];

export function isSegraRecommendedEntry(entry: {
	id: string;
	type: string;
}): boolean {
	return SEGRA_RECOMMENDED_ENTRIES.some(
		(candidate) => candidate.id === entry.id && candidate.type === entry.type,
	);
}

/**
 * Folder of a bundled Segra plugin. Packaged apps get it from the Rust shell;
 * dev runs (`bun run dev:sidecar`) fall back to the repo's `plugins/` folder.
 */
export function resolveSegraPluginDir(
	name: string,
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const roots = [
		env[SEGRA_PLUGINS_DIR_ENV]?.trim(),
		resolve(dirname(fileURLToPath(import.meta.url)), "../../../../plugins"),
	].filter((root): root is string => Boolean(root));
	for (const root of roots) {
		const dir = join(root, name);
		if (existsSync(join(dir, "package.json"))) return dir;
	}
	return undefined;
}

type CatalogRecord = Record<string, unknown> & {
	entries?: unknown;
	counts?: unknown;
};

/**
 * Adds Segra's recommended entries to a marketplace catalog, replacing any
 * upstream entry with the same id and type. A missing or broken catalog still
 * yields the recommended entries.
 */
export function withSegraRecommended(catalog: unknown): CatalogRecord {
	const base: CatalogRecord =
		catalog && typeof catalog === "object"
			? { ...(catalog as CatalogRecord) }
			: {};
	const upstream = Array.isArray(base.entries) ? base.entries : [];
	const others = upstream.filter(
		(entry) =>
			!(
				entry &&
				typeof entry === "object" &&
				isSegraRecommendedEntry(entry as { id: string; type: string })
			),
	);
	const entries = [...SEGRA_RECOMMENDED_ENTRIES, ...others];
	const counts =
		base.counts && typeof base.counts === "object"
			? (base.counts as Record<string, unknown>)
			: {};
	const pluginCount = entries.filter(
		(entry) =>
			entry &&
			typeof entry === "object" &&
			(entry as { type?: unknown }).type === "plugin",
	).length;
	return {
		version: 1,
		tags: [],
		...base,
		counts: { ...counts, total: entries.length, plugins: pluginCount },
		entries,
	};
}
