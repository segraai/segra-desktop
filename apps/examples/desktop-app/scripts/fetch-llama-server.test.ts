import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectEngineFiles } from "./fetch-llama-server";

let dir: string;

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function layout(files: string[], links: Record<string, string>) {
	dir = mkdtempSync(join(tmpdir(), "llama-release-"));
	for (const name of files) writeFileSync(join(dir, name), name);
	for (const [name, target] of Object.entries(links)) {
		symlinkSync(target, join(dir, name));
	}
}

describe("selectEngineFiles", () => {
	it("keeps the server and one copy of each library, under the name it links against", () => {
		// The Linux release's shape (macOS uses libX.0.dylib the same way).
		layout(
			[
				"llama-server",
				"llama-cli",
				"LICENSE",
				"libllama.so.0.7.0",
				"libggml-cpu-haswell.so",
				"libllama-server-impl.so",
				"libllama-cli-impl.so",
			],
			{
				"libllama.so.0": "libllama.so.0.7.0",
				"libllama.so": "libllama.so.0",
			},
		);
		const selected = selectEngineFiles(dir);
		expect([...selected.keys()].sort()).toEqual([
			"LICENSE",
			"libggml-cpu-haswell.so",
			"libllama-server-impl.so",
			"libllama.so.0",
			"llama-server",
		]);
		expect(selected.get("libllama.so.0")).toEndWith("libllama.so.0.7.0");
	});

	it("takes Windows DLLs as they are", () => {
		layout(
			[
				"llama-server.exe",
				"llama.dll",
				"ggml-vulkan.dll",
				"llama-cli-impl.dll",
			],
			{},
		);
		expect([...selectEngineFiles(dir).keys()].sort()).toEqual([
			"ggml-vulkan.dll",
			"llama-server.exe",
			"llama.dll",
		]);
	});
});
