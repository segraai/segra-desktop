import { createTool } from "@cline/core";

export function createPingTools() {
	return [
		createTool({
			name: "accountant_ping",
			description: "Checks that the Segra accountant plugin is loaded.",
			inputSchema: {
				type: "object",
				properties: {},
			},
			execute: async () => {
				return { ok: true, plugin: "segra-accountant", version: "0.0.1" };
			},
		}),
	];
}
