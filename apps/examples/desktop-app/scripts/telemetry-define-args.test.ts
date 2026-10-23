import { describe, expect, it } from "vitest";
import { telemetryDefineArgs } from "./telemetry-define-args";

function defineMap(args: string[]): Record<string, string> {
	const map: Record<string, string> = {};
	for (let index = 0; index < args.length; index += 2) {
		expect(args[index]).toBe("--define");
		const pair = args[index + 1];
		const separator = pair.indexOf("=");
		map[pair.slice(0, separator)] = pair.slice(separator + 1);
	}
	return map;
}

describe("telemetryDefineArgs", () => {
	it("inlines every telemetry var as empty, whatever the build env holds", () => {
		const env = {
			OTEL_TELEMETRY_ENABLED: "1",
			OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.com:4318",
			OTEL_EXPORTER_OTLP_HEADERS: "x-api-key=secret",
			OTEL_TRACES_EXPORTER: "otlp",
			CLINE_TRACE_SAMPLE_PERCENT: "25",
			CLINE_TRACE_RECORD_CONTENT: "true",
			TELEMETRY_SERVICE_API_KEY: "tk",
			ERROR_SERVICE_API_KEY: "ek",
		};
		for (const defines of [
			defineMap(telemetryDefineArgs(env)),
			defineMap(telemetryDefineArgs({})),
		]) {
			for (const name of Object.keys(env)) {
				expect(defines[`process.env.${name}`]).toBe('""');
			}
		}
		expect(JSON.stringify(telemetryDefineArgs(env))).not.toContain("secret");
	});
});
