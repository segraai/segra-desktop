import { LOCAL_WORKSPACE_ENVIRONMENT_ID } from "@/lib/workspace-paths";

/**
 * Segra Desktop: a new session on this computer starts as a plain chat with no
 * folder; pick a folder in the composer to work on code. Remote hosts keep
 * their last folder.
 */
export function startsAsChat(environmentId: string): boolean {
	return environmentId === LOCAL_WORKSPACE_ENVIRONMENT_ID;
}
