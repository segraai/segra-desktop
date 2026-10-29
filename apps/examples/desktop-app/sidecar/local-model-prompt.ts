import { SEGRA_LOCAL_PROVIDER_ID } from "@cline/llms";

/**
 * Built-in local models read the whole request on a laptop CPU or iGPU before
 * answering, so every token of system prompt and tool schema costs seconds.
 * Their sessions get this short prompt instead of the full Cline one, and no
 * sub-agent or agent-team tools (about 10k characters of schema a 4B model
 * can't use well anyway).
 */
export function isLocalModelProvider(providerId: unknown): boolean {
	return String(providerId ?? "").trim() === SEGRA_LOCAL_PROVIDER_ID;
}

export function buildLocalModelSystemPrompt(options: {
	cwd: string;
	mode: "act" | "plan" | "yolo";
	platform: string;
	rules?: string;
}): string {
	const sections = [
		`You are Segra Desktop, an AI assistant running on the user's computer. Help with their files, code and questions.

- If a question needs no files or commands, answer it directly without tools.
- Otherwise use the tools. Look before you change anything, follow the existing conventions, and use absolute paths.
- Keep calling tools until the task is done. A reply without tool calls ends the task.
- Finish with a short summary of what you did.

<env>
Platform: ${options.platform}
Date: ${new Date().toLocaleDateString()}${options.cwd ? `\nWorking directory: ${options.cwd}` : ""}
</env>`,
	];
	if (options.mode !== "yolo") {
		sections.push(
			`User messages arrive in a <user_input mode="..."> tag. The newest message's mode is the one that applies.`,
		);
	}
	if (options.mode === "plan") {
		sections.push(`# Plan mode

Explore and plan, don't change anything. Read files and run only read-only commands, then present a short step-by-step plan and wait. Once the user approves it in a later message, call switch_to_act_mode to start.`);
	}
	if (options.rules?.trim()) sections.push(options.rules.trim());
	return sections.join("\n\n");
}
