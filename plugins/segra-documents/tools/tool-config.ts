/**
 * A tool definition in the shape `createTool` from `@cline/core` accepts.
 * Kept free of `@cline/core` imports so the same definitions can be loaded by
 * the plugin entry (`index.ts`) and directly by Segra Desktop's backend, which
 * wraps them with its own copy of core.
 */
export interface SegraToolConfig {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	timeoutMs?: number;
	retryable?: boolean;
	// biome-ignore lint/suspicious/noExplicitAny: inputs are validated by each tool's core module
	execute: (input: any) => Promise<unknown>;
}
