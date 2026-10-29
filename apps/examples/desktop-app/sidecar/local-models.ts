/**
 * Segra Desktop's built-in local models.
 *
 * - The catalog (a few preselected GGUF files) lives in @cline/llms
 *   (vendors/segra-local.ts) so the hub knows each model's context.
 * - Files go in a shared `segra/models` folder, so Segra Meetings and this app
 *   download a model once. Meetings' current folder is also checked.
 * - llama.cpp's `llama-server` (bundled under `bin/llama`) runs them. It is
 *   started on the first request and stopped when idle, so having the app
 *   open costs no memory.
 * - A small proxy on 127.0.0.1:3127 is the provider's fixed address. Agent
 *   runs happen in the hub, which outlives this process, so the address has
 *   to stay put while the engine behind it comes and goes.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	createReadStream,
	existsSync,
	mkdirSync,
	renameSync,
	rmSync,
	statSync,
} from "node:fs";
import { open } from "node:fs/promises";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { createServer as createNetServer } from "node:net";
import { homedir, totalmem } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	getSegraLocalModel,
	recommendSegraLocalModel,
	SEGRA_LOCAL_DEFAULT_PORT,
	SEGRA_LOCAL_MODELS,
	type SegraLocalModel,
} from "@cline/llms";

const IDLE_STOP_MS = 5 * 60_000;
const ENGINE_START_TIMEOUT_MS = 180_000;
const PROGRESS_INTERVAL_MS = 250;

export type LocalModelDownload = {
	modelId: string;
	status: "downloading" | "verifying" | "done" | "error" | "cancelled";
	receivedBytes: number;
	totalBytes: number;
	error?: string;
};

type Env = Record<string, string | undefined>;

/** The folder Segra apps share for downloaded models. */
export function sharedModelsDir(
	env: Env = process.env,
	platform: NodeJS.Platform = process.platform,
	home = homedir(),
): string {
	if (env.SEGRA_MODELS_DIR?.trim()) return env.SEGRA_MODELS_DIR.trim();
	return join(appDataDir(env, platform, home), "segra", "models");
}

/** Segra Meetings' own models folder, from before the shared one. */
export function meetingsModelsDir(
	env: Env = process.env,
	platform: NodeJS.Platform = process.platform,
	home = homedir(),
): string {
	return join(
		appDataDir(env, platform, home),
		"ai.segra.meetings",
		"models",
		"summary",
	);
}

function appDataDir(env: Env, platform: NodeJS.Platform, home: string) {
	if (platform === "darwin")
		return join(home, "Library", "Application Support");
	if (platform === "win32")
		return env.APPDATA || join(home, "AppData", "Roaming");
	return env.XDG_DATA_HOME || join(home, ".local", "share");
}

/** A complete copy of the model on this computer, or null. */
export function findModelFile(
	model: SegraLocalModel,
	dirs: string[] = [sharedModelsDir(), meetingsModelsDir()],
): string | null {
	for (const dir of dirs) {
		const path = join(dir, model.file);
		try {
			if (statSync(path).size === model.bytes) return path;
		} catch {
			// Not in this folder.
		}
	}
	return null;
}

/** The bundled `llama-server`, or null when this build doesn't have it. */
export function resolveLlamaServerPath(
	env: Env = process.env,
	platform: NodeJS.Platform = process.platform,
): string | null {
	const exe = platform === "win32" ? "llama-server.exe" : "llama-server";
	const candidates = [
		env.SEGRA_LLAMA_DIR?.trim() ? join(env.SEGRA_LLAMA_DIR.trim(), exe) : "",
		// Development: scripts/fetch-llama-server.ts puts it here.
		fileURLToPath(new URL(`../src-tauri/bin/llama/${exe}`, import.meta.url)),
	];
	return candidates.find((path) => path && existsSync(path)) ?? null;
}

async function sha256OfFile(path: string) {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash;
}

/**
 * Downloads a catalog model into `dir`: streams to `<file>.part`, resumes
 * an earlier partial download, and only keeps the file if its SHA-256
 * matches the catalog.
 */
export async function downloadModel(
	model: SegraLocalModel,
	dir: string,
	options: {
		signal?: AbortSignal;
		onProgress?: (receivedBytes: number) => void;
		onVerifying?: () => void;
		fetchImpl?: typeof fetch;
	} = {},
): Promise<string> {
	mkdirSync(dir, { recursive: true });
	const finalPath = join(dir, model.file);
	const partPath = `${finalPath}.part`;
	let start = existsSync(partPath) ? statSync(partPath).size : 0;
	if (start > model.bytes) {
		rmSync(partPath);
		start = 0;
	}
	let hash = start > 0 ? await sha256OfFile(partPath) : createHash("sha256");

	const response = await (options.fetchImpl ?? fetch)(model.url, {
		headers: start > 0 ? { Range: `bytes=${start}-` } : {},
		signal: options.signal,
		redirect: "follow",
	});
	if (start > 0 && response.status === 200) {
		// The server ignored the range: start over.
		start = 0;
		hash = createHash("sha256");
	} else if (!response.ok) {
		throw new Error(`Download failed (HTTP ${response.status}).`);
	}
	if (!response.body) throw new Error("Download failed (empty response).");

	const file = await open(partPath, start > 0 ? "a" : "w");
	let received = start;
	try {
		for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
			await file.write(chunk);
			hash.update(chunk);
			received += chunk.byteLength;
			options.onProgress?.(received);
		}
	} finally {
		await file.close();
	}

	options.onVerifying?.();
	if (received !== model.bytes || hash.digest("hex") !== model.sha256) {
		rmSync(partPath, { force: true });
		throw new Error(
			"The downloaded file didn't match the expected one, so it was removed. Try again.",
		);
	}
	renameSync(partPath, finalPath);
	return finalPath;
}

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createNetServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close(() => resolve(port));
		});
	});
}

/** llama-server arguments for one model. One slot keeps the full context. */
export function llamaServerArgs(
	model: SegraLocalModel,
	modelPath: string,
	port: number,
): string[] {
	return [
		"-m",
		modelPath,
		"--host",
		"127.0.0.1",
		"--port",
		String(port),
		"--alias",
		model.id,
		"--jinja",
		"-c",
		String(model.contextWindow),
		"-np",
		"1",
		"-ngl",
		"999",
	];
}

type Engine = {
	child: ChildProcess;
	port: number;
	modelId: string;
	ready: Promise<void>;
	log: string[];
};

export type LocalModelsOptions = {
	onEvent?: (name: string, payload: unknown) => void;
	onLog?: (message: string, details?: Record<string, unknown>) => void;
	/** Called once the proxy has its port, and after a model is downloaded. */
	onEndpoint?: (baseUrl: string, isDefaultPort: boolean) => void;
	/** Runs before the "done" event, so listeners see the provider set up. */
	onDownloaded?: (modelId: string) => Promise<void>;
	modelsDirs?: () => string[];
	downloadDir?: () => string;
	serverPath?: () => string | null;
	idleStopMs?: number;
	fetchImpl?: typeof fetch;
};

export class LocalModels {
	private readonly downloads = new Map<
		string,
		LocalModelDownload & { controller?: AbortController }
	>();
	private engine: Engine | null = null;
	private engineStarting: Promise<Engine> | null = null;
	private activeRequests = 0;
	private lastUsedAt = 0;
	private idleTimer: ReturnType<typeof setInterval> | null = null;
	private proxy: Server | null = null;
	private proxyPort: number | null = null;

	constructor(private readonly options: LocalModelsOptions = {}) {}

	private modelsDirs() {
		return (
			this.options.modelsDirs?.() ?? [sharedModelsDir(), meetingsModelsDir()]
		);
	}

	private emit(name: string, payload: unknown) {
		this.options.onEvent?.(name, payload);
	}

	get baseUrl(): string | null {
		return this.proxyPort ? `http://127.0.0.1:${this.proxyPort}/v1` : null;
	}

	list() {
		const serverPath = (this.options.serverPath ?? resolveLlamaServerPath)();
		return {
			models: SEGRA_LOCAL_MODELS.map((model) => {
				const path = findModelFile(model, this.modelsDirs());
				const download = this.downloads.get(model.id);
				return {
					...model,
					downloaded: Boolean(path),
					download:
						download && download.status !== "done"
							? publicDownload(download)
							: null,
				};
			}),
			recommendedId: recommendSegraLocalModel(totalmem()).id,
			memoryBytes: totalmem(),
			engine: {
				available: Boolean(serverPath),
				running: Boolean(this.engine),
				modelId: this.engine?.modelId ?? null,
				baseUrl: this.baseUrl,
			},
		};
	}

	/** Starts (or joins) a download. Resolves when it ends, however it ends. */
	download(modelId: string): Promise<LocalModelDownload> {
		const model = getSegraLocalModel(modelId);
		if (!model) throw new Error(`Unknown local model: ${modelId}`);
		const running = this.downloads.get(modelId);
		if (running?.status === "downloading" || running?.status === "verifying") {
			return Promise.resolve(publicDownload(running));
		}
		if (findModelFile(model, this.modelsDirs())) {
			const done: LocalModelDownload = {
				modelId,
				status: "done",
				receivedBytes: model.bytes,
				totalBytes: model.bytes,
			};
			// Already here (maybe Segra Meetings downloaded it): set it up.
			return (this.options.onDownloaded?.(modelId) ?? Promise.resolve())
				.catch(() => undefined)
				.then(() => {
					this.emit("local_model_progress", done);
					return done;
				});
		}

		const controller = new AbortController();
		const state: LocalModelDownload & { controller?: AbortController } = {
			modelId,
			status: "downloading",
			receivedBytes: 0,
			totalBytes: model.bytes,
			controller,
		};
		this.downloads.set(modelId, state);
		let lastEmit = 0;
		const report = (force = false) => {
			const now = Date.now();
			if (!force && now - lastEmit < PROGRESS_INTERVAL_MS) return;
			lastEmit = now;
			this.emit("local_model_progress", publicDownload(state));
		};
		report(true);

		return downloadModel(
			model,
			this.options.downloadDir?.() ?? sharedModelsDir(),
			{
				signal: controller.signal,
				fetchImpl: this.options.fetchImpl,
				onProgress: (received) => {
					state.receivedBytes = received;
					report();
				},
				onVerifying: () => {
					state.status = "verifying";
					report(true);
				},
			},
		)
			.then(async () => {
				state.receivedBytes = model.bytes;
				await this.options.onDownloaded?.(modelId).catch((error) =>
					this.options.onLog?.("Local model setup failed", {
						modelId,
						error: String(error),
					}),
				);
				state.status = "done";
			})
			.catch((error) => {
				if (controller.signal.aborted) {
					state.status = "cancelled";
				} else {
					state.status = "error";
					state.error = error instanceof Error ? error.message : String(error);
					this.options.onLog?.("Local model download failed", {
						modelId,
						error: state.error,
					});
				}
			})
			.then(() => {
				delete state.controller;
				report(true);
				return publicDownload(state);
			});
	}

	cancel(modelId: string) {
		this.downloads.get(modelId)?.controller?.abort();
	}

	/**
	 * Deletes this app's copy. A copy in Segra Meetings' own folder is left
	 * alone: Meetings may be using it.
	 */
	async delete(modelId: string): Promise<{ deleted: boolean }> {
		const model = getSegraLocalModel(modelId);
		if (!model) throw new Error(`Unknown local model: ${modelId}`);
		this.cancel(modelId);
		if (this.engine?.modelId === modelId) await this.stopEngine();
		const dir = this.options.downloadDir?.() ?? sharedModelsDir();
		const path = join(dir, model.file);
		const existed = existsSync(path);
		rmSync(path, { force: true });
		rmSync(`${path}.part`, { force: true });
		this.downloads.delete(modelId);
		return { deleted: existed };
	}

	private async ensureEngine(model: SegraLocalModel): Promise<Engine> {
		if (this.engine?.modelId === model.id) {
			await this.engine.ready;
			return this.engine;
		}
		if (this.engineStarting) {
			const starting = await this.engineStarting.catch(() => null);
			if (starting?.modelId === model.id) return starting;
		}
		this.engineStarting = this.startEngine(model);
		try {
			return await this.engineStarting;
		} finally {
			this.engineStarting = null;
		}
	}

	private async startEngine(model: SegraLocalModel): Promise<Engine> {
		await this.stopEngine();
		const serverPath = (this.options.serverPath ?? resolveLlamaServerPath)();
		if (!serverPath) {
			throw new Error(
				"This build of Segra Desktop doesn't include the local model engine.",
			);
		}
		const modelPath = findModelFile(model, this.modelsDirs());
		if (!modelPath) {
			throw new Error(
				`${model.name} isn't downloaded yet. Download it in Settings → Models.`,
			);
		}
		const port = await freePort();
		const log: string[] = [];
		const child = spawn(serverPath, llamaServerArgs(model, modelPath, port), {
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		const keepLog = (data: Buffer) => {
			log.push(...data.toString().split("\n").filter(Boolean));
			if (log.length > 40) log.splice(0, log.length - 40);
		};
		child.stdout?.on("data", keepLog);
		child.stderr?.on("data", keepLog);

		const exited = new Promise<never>((_, reject) => {
			child.once("error", reject);
			child.once("exit", (code) => {
				if (this.engine?.child === child) this.engine = null;
				reject(
					new Error(
						`The local model engine stopped (exit ${code}). ${log.slice(-3).join(" ")}`.trim(),
					),
				);
			});
		});
		exited.catch(() => undefined);

		const ready = Promise.race([
			waitForHealth(
				`http://127.0.0.1:${port}/health`,
				ENGINE_START_TIMEOUT_MS,
				this.options.fetchImpl,
			),
			exited,
		]);
		const engine: Engine = { child, port, modelId: model.id, ready, log };
		this.engine = engine;
		this.options.onLog?.("Local model engine starting", {
			modelId: model.id,
			port,
		});
		try {
			await ready;
		} catch (error) {
			await this.stopEngine();
			throw error;
		}
		this.startIdleTimer();
		return engine;
	}

	async stopEngine(): Promise<void> {
		const engine = this.engine;
		this.engine = null;
		if (!engine || engine.child.exitCode !== null) return;
		await new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				engine.child.kill("SIGKILL");
				resolve();
			}, 5_000);
			engine.child.once("exit", () => {
				clearTimeout(timer);
				resolve();
			});
			engine.child.kill();
		});
		this.options.onLog?.("Local model engine stopped", {
			modelId: engine.modelId,
		});
	}

	private startIdleTimer() {
		if (this.idleTimer) return;
		const idleStopMs = this.options.idleStopMs ?? IDLE_STOP_MS;
		this.idleTimer = setInterval(
			() => {
				if (!this.engine) return;
				if (this.activeRequests > 0) return;
				if (Date.now() - this.lastUsedAt < idleStopMs) return;
				void this.stopEngine();
			},
			Math.min(30_000, idleStopMs),
		);
		this.idleTimer.unref?.();
	}

	/** Starts the proxy on the fixed port, or any free port if it's taken. */
	async listen(preferredPort = SEGRA_LOCAL_DEFAULT_PORT): Promise<number> {
		const server = createServer((req, res) => {
			void this.handle(req, res).catch((error) => {
				sendError(res, 500, error);
			});
		});
		const port = await new Promise<number>((resolve, reject) => {
			const tryListen = (port: number) => {
				server.once("error", (error: NodeJS.ErrnoException) => {
					if (error.code === "EADDRINUSE" && port !== 0) tryListen(0);
					else reject(error);
				});
				server.listen(port, "127.0.0.1", () => {
					const address = server.address();
					resolve(typeof address === "object" && address ? address.port : port);
				});
			};
			tryListen(preferredPort);
		});
		// Generations can be slow on a CPU; never time a request out here.
		server.requestTimeout = 0;
		server.headersTimeout = 0;
		this.proxy = server;
		this.proxyPort = port;
		this.options.onEndpoint?.(this.baseUrl as string, port === preferredPort);
		return port;
	}

	private async handle(req: IncomingMessage, res: ServerResponse) {
		const path = (req.url ?? "/").split("?")[0];
		if (req.method === "GET" && path === "/health") {
			return sendJson(res, 200, { ok: true, service: "segra-local" });
		}
		if (req.method === "GET" && path === "/v1/models") {
			return sendJson(res, 200, {
				object: "list",
				data: SEGRA_LOCAL_MODELS.filter((model) =>
					findModelFile(model, this.modelsDirs()),
				).map((model) => ({
					id: model.id,
					object: "model",
					owned_by: "segra-local",
				})),
			});
		}
		if (!path.startsWith("/v1/")) {
			return sendJson(res, 404, { error: { message: "Not found" } });
		}

		const body = await readBody(req);
		let requested: string | undefined;
		try {
			requested = JSON.parse(body.toString() || "{}")?.model;
		} catch {
			// Not JSON: forward as is to the loaded model.
		}
		const model = getSegraLocalModel(requested ?? this.engine?.modelId ?? "");
		if (!model) {
			return sendJson(res, 404, {
				error: { message: `Unknown local model: ${requested ?? "(none)"}` },
			});
		}

		this.activeRequests += 1;
		const controller = new AbortController();
		res.once("close", () => controller.abort());
		try {
			const engine = await this.ensureEngine(model);
			const upstream = await (this.options.fetchImpl ?? fetch)(
				`http://127.0.0.1:${engine.port}${req.url}`,
				{
					method: req.method,
					headers: {
						"content-type": req.headers["content-type"] ?? "application/json",
						accept: req.headers.accept ?? "*/*",
					},
					body:
						req.method === "GET" || req.method === "HEAD" ? undefined : body,
					signal: controller.signal,
				},
			);
			res.writeHead(upstream.status, {
				"content-type":
					upstream.headers.get("content-type") ?? "application/json",
				"cache-control": "no-cache",
			});
			if (upstream.body) {
				for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
					res.write(chunk);
				}
			}
			res.end();
		} catch (error) {
			if (!controller.signal.aborted) sendError(res, 503, error);
		} finally {
			this.activeRequests -= 1;
			this.lastUsedAt = Date.now();
		}
	}

	async dispose(): Promise<void> {
		for (const download of this.downloads.values())
			download.controller?.abort();
		if (this.idleTimer) clearInterval(this.idleTimer);
		this.idleTimer = null;
		await this.stopEngine();
		await new Promise<void>((resolve) => {
			if (!this.proxy) return resolve();
			this.proxy.close(() => resolve());
			this.proxy.closeAllConnections?.();
		});
		this.proxy = null;
		this.proxyPort = null;
	}
}

function publicDownload(
	state: LocalModelDownload & { controller?: AbortController },
): LocalModelDownload {
	const { controller: _controller, ...rest } = state;
	return { ...rest };
}

async function waitForHealth(
	url: string,
	timeoutMs: number,
	fetchImpl: typeof fetch = fetch,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			// 503 while the model loads, 200 once it can answer.
			const response = await fetchImpl(url, {
				signal: AbortSignal.timeout(2_000),
			});
			if (response.ok) return;
		} catch {
			// Not listening yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 300));
	}
	throw new Error("The local model took too long to load.");
}

function readBody(req: IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
	if (res.headersSent) return res.end();
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, status: number, error: unknown) {
	sendJson(res, status, {
		error: { message: error instanceof Error ? error.message : String(error) },
	});
}
