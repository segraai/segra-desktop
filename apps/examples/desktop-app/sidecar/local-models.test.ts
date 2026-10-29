import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	truncateSync,
	writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSegraLocalModel, type SegraLocalModel } from "@cline/llms";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	downloadModel,
	findModelFile,
	LocalModels,
	llamaServerArgs,
	meetingsModelsDir,
	sharedModelsDir,
} from "./local-models";

let dir: string;
const servers: Server[] = [];
const cleanups: Array<() => Promise<void>> = [];

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "segra-local-"));
});

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
	for (const server of servers.splice(0)) {
		await new Promise((resolve) => server.close(resolve));
	}
	await rm(dir, { recursive: true, force: true });
});

function listen(server: Server): Promise<number> {
	servers.push(server);
	return new Promise((resolve) =>
		server.listen(0, "127.0.0.1", () =>
			resolve((server.address() as AddressInfo).port),
		),
	);
}

/** Serves `content` with Range support, counting what it was asked for. */
async function fileServer(
	content: Buffer,
	options: { ignoreRange?: boolean } = {},
) {
	const ranges: Array<string | undefined> = [];
	const port = await listen(
		createServer((req, res) => {
			ranges.push(req.headers.range);
			const match = /bytes=(\d+)-/.exec(req.headers.range ?? "");
			if (match && !options.ignoreRange) {
				const start = Number(match[1]);
				res.writeHead(206, { "content-length": content.length - start });
				res.end(content.subarray(start));
				return;
			}
			res.writeHead(200, { "content-length": content.length });
			res.end(content);
		}),
	);
	return { url: `http://127.0.0.1:${port}/model.gguf`, ranges };
}

function fakeModel(content: Buffer, url: string): SegraLocalModel {
	return {
		id: "test-model",
		name: "Test",
		description: "",
		tier: "fast",
		file: "test.gguf",
		url,
		sha256: createHash("sha256").update(content).digest("hex"),
		bytes: content.length,
		contextWindow: 4096,
		minMemoryGb: 1,
	};
}

describe("model folders", () => {
	it("uses one Segra folder shared with Segra Meetings", () => {
		expect(sharedModelsDir({}, "linux", "/home/a")).toBe(
			"/home/a/.local/share/segra/models",
		);
		expect(sharedModelsDir({}, "darwin", "/Users/a")).toBe(
			"/Users/a/Library/Application Support/segra/models",
		);
		expect(
			sharedModelsDir(
				{ APPDATA: "C:\\Users\\a\\AppData\\Roaming" },
				"win32",
				"C:\\Users\\a",
			),
		).toContain(join("segra", "models"));
		expect(meetingsModelsDir({}, "linux", "/home/a")).toBe(
			"/home/a/.local/share/ai.segra.meetings/models/summary",
		);
	});

	it("finds a complete copy in Meetings' folder, and ignores partial files", () => {
		const model = getSegraLocalModel("qwen3.5-4b") as SegraLocalModel;
		const shared = join(dir, "shared");
		const meetings = join(dir, "meetings");
		mkdirSync(shared, { recursive: true });
		mkdirSync(meetings, { recursive: true });
		writeFileSync(join(shared, model.file), "partial");
		expect(findModelFile(model, [shared, meetings])).toBeNull();

		// Sparse: the size is what matters, not the bytes.
		writeFileSync(join(meetings, model.file), "");
		truncateSync(join(meetings, model.file), model.bytes);
		expect(findModelFile(model, [shared, meetings])).toBe(
			join(meetings, model.file),
		);
	});
});

describe("downloadModel", () => {
	const content = Buffer.from("gguf-bytes-".repeat(1000));

	it("downloads, checks the hash and keeps the file", async () => {
		const server = await fileServer(content);
		const model = fakeModel(content, server.url);
		const progress: number[] = [];
		const path = await downloadModel(model, dir, {
			onProgress: (received) => progress.push(received),
		});
		expect(readFileSync(path)).toEqual(content);
		expect(progress.at(-1)).toBe(content.length);
		expect(existsSync(`${path}.part`)).toBe(false);
	});

	it("resumes a partial download with a Range request", async () => {
		const server = await fileServer(content);
		const model = fakeModel(content, server.url);
		writeFileSync(join(dir, `${model.file}.part`), content.subarray(0, 4000));
		const path = await downloadModel(model, dir);
		expect(server.ranges).toEqual(["bytes=4000-"]);
		expect(readFileSync(path)).toEqual(content);
	});

	it("starts over when the server ignores the range", async () => {
		const server = await fileServer(content, { ignoreRange: true });
		const model = fakeModel(content, server.url);
		writeFileSync(join(dir, `${model.file}.part`), content.subarray(0, 4000));
		const path = await downloadModel(model, dir);
		expect(readFileSync(path)).toEqual(content);
	});

	it("removes a file whose hash doesn't match", async () => {
		const server = await fileServer(content);
		const model = { ...fakeModel(content, server.url), sha256: "0".repeat(64) };
		await expect(downloadModel(model, dir)).rejects.toThrow(/didn't match/);
		expect(existsSync(join(dir, model.file))).toBe(false);
		expect(existsSync(join(dir, `${model.file}.part`))).toBe(false);
	});
});

describe("llamaServerArgs", () => {
	it("loads the model's full context in one slot, on loopback", () => {
		const model = getSegraLocalModel("qwen3.5-9b") as SegraLocalModel;
		const args = llamaServerArgs(model, "/m.gguf", 4321);
		expect(args.join(" ")).toContain("--host 127.0.0.1 --port 4321");
		expect(args.join(" ")).toContain("-c 32768 -np 1");
		expect(args).toContain("--jinja");
	});
});

describe("LocalModels proxy", () => {
	const model = getSegraLocalModel("qwen3.5-4b") as SegraLocalModel;

	/** A stand-in for llama-server: /health, and a streamed chat reply. */
	function fakeEngine() {
		const script = join(dir, "fake-llama-server.mjs");
		writeFileSync(
			script,
			`import { createServer } from "node:http";
const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]);
const alias = args[args.indexOf("--alias") + 1];
createServer((req, res) => {
  if (req.url === "/health") { res.writeHead(200); return res.end("{}"); }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: " + JSON.stringify({ model: alias, got: JSON.parse(body).messages[0].content }) + "\\n\\n");
    res.end("data: [DONE]\\n\\n");
  });
}).listen(port, "127.0.0.1");
`,
		);
		const launcher = join(dir, "llama-server");
		writeFileSync(
			launcher,
			`#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`,
		);
		chmodSync(launcher, 0o755);
		return launcher;
	}

	function downloaded(folder: string) {
		mkdirSync(folder, { recursive: true });
		writeFileSync(join(folder, model.file), "");
		truncateSync(join(folder, model.file), model.bytes);
	}

	async function start(
		options: ConstructorParameters<typeof LocalModels>[0] = {},
	) {
		const models = new LocalModels({
			modelsDirs: () => [join(dir, "models")],
			downloadDir: () => join(dir, "models"),
			serverPath: fakeEngine,
			...options,
		});
		cleanups.push(() => models.dispose());
		const port = await models.listen(0);
		return { models, url: `http://127.0.0.1:${port}` };
	}

	it("lists only downloaded models", async () => {
		const { url } = await start();
		let body = await (await fetch(`${url}/v1/models`)).json();
		expect(body.data).toEqual([]);
		downloaded(join(dir, "models"));
		body = await (await fetch(`${url}/v1/models`)).json();
		expect(body.data.map((m: { id: string }) => m.id)).toEqual([model.id]);
	});

	it("starts the engine on the first request and streams its reply", async () => {
		downloaded(join(dir, "models"));
		const { models, url } = await start();
		expect(models.list().engine.running).toBe(false);
		const response = await fetch(`${url}/v1/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: model.id,
				stream: true,
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(response.headers.get("content-type")).toBe("text/event-stream");
		const text = await response.text();
		expect(text).toContain(`"model":"${model.id}"`);
		expect(text).toContain(`"got":"hi"`);
		expect(models.list().engine).toMatchObject({
			running: true,
			modelId: model.id,
		});
	});

	it("explains when the requested model isn't downloaded", async () => {
		const { url } = await start();
		const response = await fetch(`${url}/v1/chat/completions`, {
			method: "POST",
			body: JSON.stringify({ model: model.id, messages: [] }),
		});
		expect(response.status).toBe(503);
		expect((await response.json()).error.message).toMatch(/isn't downloaded/);
	});

	it("stops the engine once idle", async () => {
		downloaded(join(dir, "models"));
		const { models, url } = await start({ idleStopMs: 50 });
		await fetch(`${url}/v1/chat/completions`, {
			method: "POST",
			body: JSON.stringify({ model: model.id, messages: [{ content: "x" }] }),
		}).then((r) => r.text());
		expect(models.list().engine.running).toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(models.list().engine.running).toBe(false);
	});

	it("moves to a free port when the usual one is taken", async () => {
		const taken = await listen(createServer(() => undefined));
		const endpoints: Array<[string, boolean]> = [];
		const models = new LocalModels({
			onEndpoint: (baseUrl, isDefault) => endpoints.push([baseUrl, isDefault]),
		});
		cleanups.push(() => models.dispose());
		const port = await models.listen(taken);
		expect(port).not.toBe(taken);
		expect(endpoints).toEqual([[`http://127.0.0.1:${port}/v1`, false]]);
	});
});
