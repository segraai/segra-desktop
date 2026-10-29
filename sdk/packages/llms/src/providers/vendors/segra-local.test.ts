import { describe, expect, it } from "vitest";
import { getModelsForProvider, getProvider } from "../model-registry";
import {
	getSegraLocalModel,
	recommendSegraLocalModel,
	SEGRA_LOCAL_DEFAULT_BASE_URL,
	SEGRA_LOCAL_MODELS,
	SEGRA_LOCAL_PROVIDER_ID,
} from "./segra-local";

const GB = 1024 ** 3;

describe("recommendSegraLocalModel", () => {
	it("picks the fast model for small machines", () => {
		expect(recommendSegraLocalModel(8 * GB).tier).toBe("fast");
		expect(recommendSegraLocalModel(4 * GB).tier).toBe("fast");
	});

	it("keeps the fast model on typical machines, even with 32 GB", () => {
		expect(recommendSegraLocalModel(16 * GB).tier).toBe("fast");
		expect(recommendSegraLocalModel(32 * GB).tier).toBe("fast");
	});

	it("picks the balanced model only with 64 GB, allowing for reported slack", () => {
		expect(recommendSegraLocalModel(63 * GB).tier).toBe("balanced");
		expect(recommendSegraLocalModel(60 * GB).tier).toBe("fast");
	});

	it("never picks the 22 GB tier on its own", () => {
		expect(recommendSegraLocalModel(128 * GB).tier).toBe("balanced");
	});
});

describe("segra-local provider", () => {
	it("is a keyless OpenAI-compatible provider on the sidecar's loopback port", async () => {
		const provider = await getProvider(SEGRA_LOCAL_PROVIDER_ID);
		expect(provider?.baseUrl).toBe(SEGRA_LOCAL_DEFAULT_BASE_URL);
		expect(provider?.metadata?.apiKeyOptional).toBe(true);
	});

	it("lists every catalog model with the context it is loaded with", async () => {
		const models = await getModelsForProvider(SEGRA_LOCAL_PROVIDER_ID);
		for (const model of SEGRA_LOCAL_MODELS) {
			expect(models[model.id]?.contextWindow).toBe(model.contextWindow);
		}
		expect(Object.keys(models)).toHaveLength(SEGRA_LOCAL_MODELS.length);
	});

	it("shares file names with Segra Meetings' built-in models", () => {
		expect(getSegraLocalModel("qwen3.5-4b")?.file).toBe(
			"Qwen3.5-4B-Q4_K_M.gguf",
		);
	});
});
