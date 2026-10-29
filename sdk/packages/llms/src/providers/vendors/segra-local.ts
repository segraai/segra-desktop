/**
 * Segra Desktop's built-in local models: a few preselected GGUF files run by
 * llama.cpp's `llama-server` on this computer. The desktop sidecar downloads
 * them, starts the server on demand and serves an OpenAI-compatible API on
 * loopback (see apps/examples/desktop-app/sidecar/local-models.ts).
 *
 * File names match Segra Meetings' built-in models so both apps can share
 * one download (the shared `segra/models` folder).
 */

export const SEGRA_LOCAL_PROVIDER_ID = "segra-local";

/** The sidecar's local endpoint. It moves only when this port is taken. */
export const SEGRA_LOCAL_DEFAULT_PORT = 3127;
export const SEGRA_LOCAL_DEFAULT_BASE_URL = `http://127.0.0.1:${SEGRA_LOCAL_DEFAULT_PORT}/v1`;

export interface SegraLocalModel {
	id: string;
	name: string;
	/** One line for the picker and the setup screens. */
	description: string;
	tier: "fast" | "balanced" | "best";
	file: string;
	url: string;
	sha256: string;
	bytes: number;
	/** Context `llama-server` loads the model with (`-c`). */
	contextWindow: number;
	/** Total memory this computer should have to run it comfortably. */
	minMemoryGb: number;
}

export const SEGRA_LOCAL_MODELS: readonly SegraLocalModel[] = [
	{
		id: "qwen3.5-4b",
		name: "Qwen 3.5 4B",
		description: "Fastest. The right choice for most computers.",
		tier: "fast",
		file: "Qwen3.5-4B-Q4_K_M.gguf",
		url: "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf",
		sha256: "00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4",
		bytes: 2_740_937_888,
		contextWindow: 32_768,
		minMemoryGb: 8,
	},
	{
		id: "qwen3.5-9b",
		name: "Qwen 3.5 9B",
		description: "Smarter but much slower. For computers with 64 GB of memory or more.",
		tier: "balanced",
		file: "Qwen3.5-9B-Q4_K_M.gguf",
		url: "https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf",
		sha256: "03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8",
		bytes: 5_680_522_464,
		contextWindow: 32_768,
		minMemoryGb: 16,
	},
	{
		id: "qwen3.5-35b-a3b",
		name: "Qwen 3.5 35B",
		description: "Best quality. Only for high-end computers with lots of memory; a 22 GB download.",
		tier: "best",
		file: "Qwen3.5-35B-A3B-Q4_K_M.gguf",
		url: "https://huggingface.co/unsloth/Qwen3.5-35B-A3B-GGUF/resolve/main/Qwen3.5-35B-A3B-Q4_K_M.gguf",
		sha256: "3b46d1066bc91cc2d613e3bc22ce691dd77e6f0d33c9060690d24ce6de494375",
		bytes: 22_016_023_168,
		contextWindow: 65_536,
		minMemoryGb: 32,
	},
];

export function getSegraLocalModel(id: string): SegraLocalModel | undefined {
	return SEGRA_LOCAL_MODELS.find((model) => model.id === id);
}

/** Below this, even the balanced model is too slow to be pleasant. */
const SEGRA_LOCAL_BALANCED_RECOMMEND_GB = 64;

/**
 * The model first run downloads. Local models run slowly on typical laptops
 * (a 9B model takes minutes per answer on a 32 GB i7 laptop), so the fast one
 * is the pick unless the computer has a lot of memory. The 22 GB tier is
 * never picked for people; they opt in. Machines report a little less than
 * their marketed size, hence the slack.
 */
export function recommendSegraLocalModel(
	totalMemoryBytes: number,
): SegraLocalModel {
	const memoryGb = totalMemoryBytes / 1024 ** 3;
	const tier =
		memoryGb + 1.5 >= SEGRA_LOCAL_BALANCED_RECOMMEND_GB ? "balanced" : "fast";
	return (
		SEGRA_LOCAL_MODELS.find((model) => model.tier === tier) ??
		SEGRA_LOCAL_MODELS[0]
	);
}
