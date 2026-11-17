import { describe, expect, it } from "vitest";
import {
	CUSTOMIZATION_SECTIONS,
	customizationSectionsForMode,
	isSectionAvailableInMode,
	SETTINGS_SECTIONS,
	settingsSectionsForMode,
} from "./sections";

describe("settings sections by mode", () => {
	it("hides Import and Remote in normal mode", () => {
		const sections = settingsSectionsForMode("normal");
		expect(sections).not.toContain("Import");
		expect(sections).not.toContain("Remote");
		expect(sections).toEqual(
			SETTINGS_SECTIONS.filter((s) => s !== "Import" && s !== "Remote"),
		);
		expect(customizationSectionsForMode("normal")).toEqual(
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
		expect(isSectionAvailableInMode("Import", "normal")).toBe(false);
		expect(isSectionAvailableInMode("Remote", "normal")).toBe(false);
		expect(isSectionAvailableInMode("Marketplace", "normal")).toBe(false);
		expect(isSectionAvailableInMode("General", "normal")).toBe(true);
		expect(isSectionAvailableInMode("Import", "developer")).toBe(true);
		expect(isSectionAvailableInMode("Marketplace", "developer")).toBe(true);
	});
});
