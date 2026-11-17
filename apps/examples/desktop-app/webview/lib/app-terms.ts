import { type AppMode, useAppMode } from "./app-mode";

export type AppTerms = {
	workspace: string;
	Workspace: string;
	workspaces: string;
	Workspaces: string;
	project: string;
	Project: string;
	welcomeHeading: string;
	searchWorkspacesPlaceholder: string;
};

const DEVELOPER_TERMS: AppTerms = {
	workspace: "workspace",
	Workspace: "Workspace",
	workspaces: "workspaces",
	Workspaces: "Workspaces",
	project: "project",
	Project: "Project",
	welcomeHeading: "What would you like to build?",
	searchWorkspacesPlaceholder: "Search workspaces, or type a folder path",
};

// People organize their own folders (by client, by year, by engagement),
// so the wording says "folder" and doesn't assume one folder per client.
const NORMAL_TERMS: AppTerms = {
	workspace: "folder",
	Workspace: "Folder",
	workspaces: "folders",
	Workspaces: "Folders",
	project: "folder",
	Project: "Folder",
	welcomeHeading: "What would you like to work on?",
	searchWorkspacesPlaceholder: "Search folders, or type a folder path",
};

export function termsForMode(mode: AppMode): AppTerms {
	return mode === "normal" ? NORMAL_TERMS : DEVELOPER_TERMS;
}

export function useTerms(): AppTerms {
	return termsForMode(useAppMode());
}
