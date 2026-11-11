import { describe, expect, it } from "vitest";
import {
	CUSTOMIZATION_SECTIONS,
	customizationSectionsForMode,
	isSectionAvailableInMode,
	SETTINGS_SECTIONS,
	settingsSectionsForMode,
} from "./sections";

describe("settings sections by mode", () => {
	it("hides Import and Remote for accountants", () => {
		const sections = settingsSectionsForMode("accountant");
		expect(sections).not.toContain("Import");
		expect(sections).not.toContain("Remote");
		expect(sections).toEqual(
			SETTINGS_SECTIONS.filter((s) => s !== "Import" && s !== "Remote"),
		);
		expect(customizationSectionsForMode("accountant")).toEqual(
			CUSTOMIZATION_SECTIONS.filter((s) => s !== "Marketplace"),
		);
	});

	it("leaves developer mode unchanged", () => {
		expect(settingsSectionsForMode("developer")).toEqual(SETTINGS_SECTIONS);
		expect(customizationSectionsForMode("developer")).toEqual(
			CUSTOMIZATION_SECTIONS,
		);
	});

	it("reports availability per mode", () => {
		expect(isSectionAvailableInMode("Import", "accountant")).toBe(false);
		expect(isSectionAvailableInMode("Remote", "accountant")).toBe(false);
		expect(isSectionAvailableInMode("Marketplace", "accountant")).toBe(false);
		expect(isSectionAvailableInMode("General", "accountant")).toBe(true);
		expect(isSectionAvailableInMode("Import", "developer")).toBe(true);
		expect(isSectionAvailableInMode("Marketplace", "developer")).toBe(true);
	});
});
