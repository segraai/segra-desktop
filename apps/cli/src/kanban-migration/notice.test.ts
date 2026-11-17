import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	getClineCliMigrationNotice,
	markClineCliMigrationNoticeShown,
	resolveCliNoticeStatePath,
	shouldSuppressClineCliMigrationNoticeForActiveProvider,
} from "./notice";

const tempDirs: string[] = [];

function createTempDataDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "cline-cli-notice-"));
	tempDirs.push(dir);
	return dir;
}

describe("startup notice", () => {
	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	// Segra doesn't show upstream Cline's promos (ClinePass, Cline Desktop).
	it("shows no notice for a fresh data dir", () => {
		expect(getClineCliMigrationNotice(createTempDataDir())).toBeUndefined();
	});

	it("shows no notice even when the old force flag is set", () => {
		expect(
			getClineCliMigrationNotice(createTempDataDir(), {
				CLINE_FORCE_CLINE_PASS_NOTICE: "1",
			}),
		).toBeUndefined();
	});

	it("records a notice as shown by id", () => {
		const dataDir = createTempDataDir();

		markClineCliMigrationNoticeShown(dataDir, "segra-notice");

		const rawState = readFileSync(resolveCliNoticeStatePath(dataDir), "utf8");
		expect(rawState).toContain('"segra-notice": true');
	});

	it("suppresses the active ClinePass provider even when the provider id has surrounding whitespace", () => {
		expect(
			shouldSuppressClineCliMigrationNoticeForActiveProvider(" cline-pass "),
		).toBe(true);
	});
});
