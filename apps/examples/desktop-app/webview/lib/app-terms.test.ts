import { describe, expect, it } from "vitest";
import { termsForMode } from "./app-terms";

describe("termsForMode", () => {
	it("keeps developer wording", () => {
		expect(termsForMode("developer")).toEqual({
			workspace: "workspace",
			Workspace: "Workspace",
			workspaces: "workspaces",
			Workspaces: "Workspaces",
			project: "project",
			Project: "Project",
			welcomeHeading: "What would you like to build?",
			searchWorkspacesPlaceholder: "Search workspaces, or type a folder path",
		});
	});

	it("uses folder wording for accountants", () => {
		expect(termsForMode("accountant")).toEqual({
			workspace: "folder",
			Workspace: "Folder",
			workspaces: "folders",
			Workspaces: "Folders",
			project: "folder",
			Project: "Folder",
			welcomeHeading: "What would you like to work on?",
			searchWorkspacesPlaceholder: "Search folders, or type a folder path",
		});
	});
});
