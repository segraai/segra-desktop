import type { AgentMessage, AgentModelEvent } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createGateway } from "./gateway";

const KLEIN = "black-forest-labs/FLUX.2-klein-4B";
const PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function collect(
	iterable: AsyncIterable<AgentModelEvent>,
): Promise<AgentModelEvent[]> {
	const events: AgentModelEvent[] = [];
	for await (const event of iterable) {
		events.push(event);
	}
	return events;
}

function nearaiGateway(fetchMock: typeof fetch) {
	// No `models`: the built-in NEAR AI catalog must list klein itself.
	return createGateway({
		providerConfigs: [
			{ providerId: "nearai", apiKey: "test", fetch: fetchMock },
		],
	});
}

const imageResponse = () =>
	Response.json(
		{ created: 1, data: [{ b64_json: PNG_BASE64 }] },
		{ status: 200, headers: { "content-type": "application/json" } },
	);

const generatedImage = expect.objectContaining({
	type: "media",
	media: expect.objectContaining({
		modality: "image",
		mediaType: "image/png",
		source: { type: "base64", data: PNG_BASE64 },
	}),
});

describe("NEAR AI image transport", () => {
	it("generates an image from text through /images/generations", async () => {
		let body: Record<string, unknown> | undefined;
		const fetchMock = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) => {
				body = JSON.parse(String(init?.body)) as Record<string, unknown>;
				return imageResponse();
			},
		);
		const messages: AgentMessage[] = [
			{
				id: "user_1",
				role: "user",
				content: [{ type: "text", text: "a red circle on white" }],
				createdAt: Date.now(),
			},
		];

		const events = await collect(
			await nearaiGateway(fetchMock as typeof fetch).stream({
				providerId: "nearai",
				modelId: KLEIN,
				messages,
			}),
		);

		expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
			"https://cloud-api.near.ai/v1/images/generations",
		);
		expect(body).toMatchObject({
			model: KLEIN,
			prompt: "a red circle on white",
		});
		expect(events).toContainEqual(generatedImage);
	});

	it("edits an attached image through /images/edits", async () => {
		let form: FormData | undefined;
		const fetchMock = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) => {
				form = init?.body as FormData;
				return imageResponse();
			},
		);
		const messages: AgentMessage[] = [
			{
				id: "user_1",
				role: "user",
				content: [
					{ type: "image", image: PNG_BASE64, mediaType: "image/png" },
					{ type: "text", text: "Remove the text" },
				],
				createdAt: Date.now(),
			},
		];

		const events = await collect(
			await nearaiGateway(fetchMock as typeof fetch).stream({
				providerId: "nearai",
				modelId: KLEIN,
				messages,
			}),
		);

		expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
			"https://cloud-api.near.ai/v1/images/edits",
		);
		expect(form?.get("model")).toBe(KLEIN);
		expect(form?.get("prompt")).toBe("Remove the text");
		expect(form?.get("image")).toBeInstanceOf(Blob);
		expect(events).toContainEqual(generatedImage);
	});
});
