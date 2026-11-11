import type { AgentPlugin } from "@cline/core";
import { createDocumentTools } from "./tools/document.ts";
import { createPingTools } from "./tools/ping.ts";
import { createWorkbookTools } from "./tools/workbook.ts";

const plugin: AgentPlugin = {
	name: "segra-accountant",
	manifest: {
		capabilities: ["tools"],
	},

	setup(api) {
		const tools = [
			...createPingTools(),
			...createWorkbookTools(),
			...createDocumentTools(),
		];
		for (const tool of tools) {
			api.registerTool(tool);
		}
	},
};

export default plugin;
