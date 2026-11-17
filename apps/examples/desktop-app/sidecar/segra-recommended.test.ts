import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	resolveSegraPluginDir,
	SEGRA_PLUGINS_DIR_ENV,
	SEGRA_RECOMMENDED_ENTRIES,
	withSegraRecommended,
} from "./segra-recommended";

describe("withSegraRecommended", () => {
	it("puts Segra's entries first and replaces an upstream entry with the same id", () => {
		const catalog = withSegraRecommended({
			version: 3,
			tags: [{ id: "memory", label: "Memory", count: 1 }],
			counts: { total: 2, plugins: 1, skills: 1, mcps: 0 },
			entries: [
				{ id: "segra-claude-mem", type: "plugin", name: "upstream copy" },
				{ id: "goal", type: "plugin", name: "Goal" },
				{ id: "some-skill", type: "skill", name: "Skill" },
			],
		});
		const entries = catalog.entries as Array<{ id: string; name: string }>;
		expect(entries.map((entry) => entry.id)).toEqual([
			"segra-claude-mem",
			"goal",
			"some-skill",
		]);
		expect(entries[0].name).toBe("claude-mem memory");
		expect(catalog.version).toBe(3);
		expect(catalog.counts).toEqual({
			total: 3,
			plugins: 2,
			skills: 1,
			mcps: 0,
		});
	});

	it("still lists Segra's entries when there is no upstream catalog", () => {
		const catalog = withSegraRecommended(undefined);
		expect(catalog.entries).toEqual([...SEGRA_RECOMMENDED_ENTRIES]);
		expect(catalog.tags).toEqual([]);
	});
});

describe("resolveSegraPluginDir", () => {
	it("prefers the folder the Rust shell points at", async () => {
		const root = await mkdtemp(join(tmpdir(), "segra-plugins-"));
		try {
			await mkdir(join(root, "segra-claude-mem"));
			await writeFile(join(root, "segra-claude-mem", "package.json"), "{}");
			expect(
				resolveSegraPluginDir("segra-claude-mem", {
					[SEGRA_PLUGINS_DIR_ENV]: root,
				}),
			).toBe(join(root, "segra-claude-mem"));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("falls back to the repo's plugins folder in dev", () => {
		expect(resolveSegraPluginDir("segra-claude-mem", {})).toMatch(
			/[\\/]plugins[\\/]segra-claude-mem$/,
		);
		expect(resolveSegraPluginDir("no-such-plugin", {})).toBeUndefined();
	});
});
