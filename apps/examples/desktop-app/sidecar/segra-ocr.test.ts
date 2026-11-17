import { describe, expect, it } from "vitest";
import { cleanOcrText, createSegraRemoteOcr } from "./segra-ocr";

const image = { data: Buffer.from("png"), mediaType: "image/png" as const };
const creds = () => ({ apiKey: "k", baseUrl: "https://segra.test/api/app/v1" });

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

function setup(opts: {
	me?: unknown;
	chat?: () => Response | Promise<Response>;
	credentials?: typeof creds | (() => undefined);
}) {
	const calls = { me: 0, chat: 0, bodies: [] as any[] };
	let time = 0;
	const fetchFn = (async (url: string) => {
		if (String(url).endsWith("/me")) {
			calls.me++;
			return json(opts.me ?? {});
		}
		throw new Error(`unexpected ${url}`);
	}) as unknown as typeof fetch;
	const modelFetch = (() => async (_url: string, init: RequestInit) => {
		calls.chat++;
		calls.bodies.push(JSON.parse(String(init.body)));
		return opts.chat?.() ?? json({});
	}) as unknown as () => typeof fetch;
	const ocr = createSegraRemoteOcr({
		getCredentials: opts.credentials ?? creds,
		fetch: fetchFn,
		modelFetch,
		now: () => time,
	});
	return { ocr, calls, advance: (ms: number) => (time += ms) };
}

const ready = { ocr: { model: "unlimited-ocr", status: "ready", credits: 5 } };
const reply = (content: string) => () =>
	json({ choices: [{ message: { content } }] });

describe("cleanOcrText", () => {
	it("strips detection boxes and special tokens", () => {
		expect(
			cleanOcrText(
				"<|det|>text [87, 270, 442, 290]<|/det|>Box 14 Employment income 68,450.00\n<|det|>text [1, 2, 3, 4]<|/det|>Maplewood<|end|>",
			),
		).toBe("Box 14 Employment income 68,450.00\nMaplewood");
	});
});

describe("createSegraRemoteOcr", () => {
	it("calls the model and returns cleaned text", async () => {
		const { ocr, calls } = setup({
			me: ready,
			chat: reply("<|det|>t [1,2,3,4]<|/det|>Total 68,450.00"),
		});
		expect(await ocr(image)).toBe("Total 68,450.00");
		expect(calls.bodies[0]).toMatchObject({
			model: "unlimited-ocr",
			temperature: 0,
			max_tokens: 4096,
			skip_special_tokens: false,
		});
		expect(calls.bodies[0].messages[0].content[0].image_url.url).toBe(
			`data:image/png;base64,${Buffer.from("png").toString("base64")}`,
		);
	});

	it("returns undefined without a key, or when OCR is absent or not ready", async () => {
		const noKey = setup({ credentials: () => undefined });
		expect(await noKey.ocr(image)).toBeUndefined();
		expect(noKey.calls.me).toBe(0);
		const absent = setup({ me: {} });
		expect(await absent.ocr(image)).toBeUndefined();
		const notReady = setup({
			me: { ocr: { model: "m", status: "setting_up", credits: 1 } },
		});
		expect(await notReady.ocr(image)).toBeUndefined();
		expect(notReady.calls.chat).toBe(0);
	});

	it("caches /me for 60 seconds", async () => {
		const { ocr, calls, advance } = setup({ me: ready, chat: reply("x") });
		await ocr(image);
		await ocr(image);
		expect(calls.me).toBe(1);
		advance(61_000);
		await ocr(image);
		expect(calls.me).toBe(2);
	});

	it("returns undefined and refreshes /me after 402, 403 and 409", async () => {
		for (const status of [402, 403, 409]) {
			const { ocr, calls } = setup({
				me: ready,
				chat: () => json({ error: { message: "no" } }, status),
			});
			expect(await ocr(image)).toBeUndefined();
			await ocr(image);
			expect(calls.me).toBe(2);
		}
	});

	it("never throws on network errors or bad bodies", async () => {
		const failing = setup({
			me: ready,
			chat: () => {
				throw new Error("network");
			},
		});
		expect(await failing.ocr(image)).toBeUndefined();
		const bad = setup({ me: ready, chat: () => json({ choices: [] }) });
		expect(await bad.ocr(image)).toBeUndefined();
	});
});
