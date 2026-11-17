import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveClineDataDir } from "@cline/shared/storage";

export const CLINE_PASS_NOTICE_ID = "cline-cli-cline-pass-intro";
const FORCE_NOTICE_ENV = "CLINE_FORCE_CLINE_PASS_NOTICE";

export interface CliMigrationNotice {
	id: string;
	title: string;
	body: string;
	url: string;
	openLabel: string;
}

export interface CliMigrationNoticeOptions {
	activeProviderId?: string;
}

interface CliNoticeState {
	shown: Record<string, boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJsonRecord(filePath: string): Record<string, unknown> | undefined {
	if (!existsSync(filePath)) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function readNoticeState(filePath: string): CliNoticeState {
	const parsed = readJsonRecord(filePath);
	const shown: Record<string, boolean> = {};
	if (!parsed) {
		return { shown };
	}
	const rawShown = parsed.shown;
	if (!isRecord(rawShown)) {
		return { shown };
	}
	for (const [key, value] of Object.entries(rawShown)) {
		if (typeof value === "boolean") {
			shown[key] = value;
		}
	}
	return { shown };
}

function isForceNoticeEnabled(env: NodeJS.ProcessEnv): boolean {
	return env[FORCE_NOTICE_ENV]?.trim() === "1";
}

export function shouldSuppressClineCliMigrationNoticeForActiveProvider(
	activeProviderId: string | undefined,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	return (
		activeProviderId?.trim() === "cline-pass" && !isForceNoticeEnabled(env)
	);
}

export function resolveCliNoticeStatePath(
	dataDir = resolveClineDataDir(),
): string {
	return join(dataDir, "settings", "cli-notices.json");
}

/**
 * Startup notice for this launch, if any. Segra ships none today: upstream
 * Cline's notices ("Try ClinePass", "Introducing Cline Desktop") advertised
 * Cline products. The shown-state plumbing stays for future Segra notices.
 */
export function getClineCliMigrationNotice(
	_dataDir = resolveClineDataDir(),
	_env: NodeJS.ProcessEnv = process.env,
	_options: CliMigrationNoticeOptions = {},
): CliMigrationNotice | undefined {
	return undefined;
}

export function markClineCliMigrationNoticeShown(
	dataDir = resolveClineDataDir(),
	noticeId = CLINE_PASS_NOTICE_ID,
): void {
	const noticePath = resolveCliNoticeStatePath(dataDir);
	const noticeState = readNoticeState(noticePath);
	const nextState: CliNoticeState = {
		shown: {
			...noticeState.shown,
			[noticeId]: true,
		},
	};
	mkdirSync(dirname(noticePath), { recursive: true, mode: 0o700 });
	writeFileSync(noticePath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
}
