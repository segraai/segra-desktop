/**
 * Build-time inlining of the telemetry configuration, mirroring the CLI
 * bundle (`apps/cli/bun.mts`). `getTelemetryBuildTimeConfig` in
 * `@cline/shared` reads `process.env.OTEL_*` at runtime, which is always
 * empty for a packaged app launched from Finder/the Dock — so the packaged
 * sidecar binary must have these values substituted into the bundle at
 * build time. Vars that are unset at build time inline as "" (telemetry
 * stays disabled), which keeps local/dev builds opted out without any
 * keys living in the repo.
 */

/** Inlined only when present so secrets never inline as empty markers. */
const OPTIONAL_SECRET_ENV_VARS = [
	"TELEMETRY_SERVICE_API_KEY",
	"ERROR_SERVICE_API_KEY",
] as const;

/**
 * Every env var `getTelemetryBuildTimeConfig` reads
 * (sdk/packages/shared/src/services/telemetry-config.ts), plus the trace
 * policy vars the Langfuse relay reads literally
 * (sdk/packages/llms/src/services/langfuse-telemetry.ts). Always inlined,
 * defaulting to "", so a packaged binary never falls back to runtime env.
 * Mirrors BUILD_TIME_INLINED_ENV_VARS in apps/cli/script/compile-binary.ts,
 * which bakes the same set into the bundled Cline CLI (the Hub daemon).
 */
const OTEL_ENV_VARS = [
	"OTEL_TELEMETRY_ENABLED",
	"OTEL_METRICS_EXPORTER",
	"OTEL_LOGS_EXPORTER",
	"OTEL_TRACES_EXPORTER",
	"CLINE_TRACE_SAMPLE_PERCENT",
	"CLINE_TRACE_RECORD_CONTENT",
	"OTEL_EXPORTER_OTLP_PROTOCOL",
	"OTEL_EXPORTER_OTLP_ENDPOINT",
	"OTEL_EXPORTER_OTLP_HEADERS",
	"OTEL_METRIC_EXPORT_INTERVAL",
] as const;

/**
 * `--define` argument pairs for `bun build`, e.g.
 * `["--define", 'process.env.OTEL_TELEMETRY_ENABLED="1"', ...]`.
 */
export function telemetryDefineArgs(
	_env: Record<string, string | undefined> = process.env,
): string[] {
	const args: string[] = [];
	const define = (name: string, value: string) => {
		args.push("--define", `process.env.${name}=${JSON.stringify(value)}`);
	};
	// Segra Desktop: telemetry keys and OTEL settings always inline as "", so
	// a packaged build can never report to Cline (or anyone) even when the
	// build machine has these set.
	for (const name of [...OPTIONAL_SECRET_ENV_VARS, ...OTEL_ENV_VARS]) {
		define(name, "");
	}
	return args;
}
