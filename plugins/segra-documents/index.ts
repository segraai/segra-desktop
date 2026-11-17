import { type AgentPlugin, createTool } from "@cline/core";
import { SEGRA_DOCUMENT_TOOLS } from "./tools/index.ts";

// Segra Desktop has these tools built in. This plugin entry is for the CLI
// (`segra plugin install plugins/segra-documents`).
const plugin: AgentPlugin = {
	name: "segra-documents",
	manifest: {
		capabilities: ["tools"],
	},

	setup(api) {
		for (const tool of SEGRA_DOCUMENT_TOOLS) {
			api.registerTool(createTool(tool));
		}
	},
};

export default plugin;
