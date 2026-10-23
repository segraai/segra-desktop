"use client";

import type { SearchComboboxOption } from "@cline/ui";
import { useCallback, useEffect, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";
import type { ModelPickerData } from "@/lib/featured-models";
import { subscribeToProviderCatalogInvalidation } from "@/lib/provider-model-catalog";

export const SEGRA_PROVIDER_ID = "segra";

// `GET {segra}/models`, as relayed by the sidecar's `segra_models` command.
// `segra_available` is only present when the app is signed in.
interface SegraCatalog {
	segra_models_url?: string;
	segra_pro_url?: string;
	segra_tier?: "free" | "paid";
	data?: Array<{
		id: string;
		name?: string;
		description?: string;
		segra_pro?: boolean;
		segra_available?: boolean;
	}>;
}

export interface SegraModelAccess {
	modelsUrl: string | null;
	proUrl: string | null;
	byId: Map<
		string,
		{ name?: string; description?: string; pro: boolean; available: boolean }
	>;
}

/**
 * Which Segra models are Pro and which ones the signed-in account can use.
 * Loaded when the Segra provider is active, on sign-in changes, and whenever
 * `refresh` is called (the picker calls it on open).
 */
export function useSegraModelAccess(active: boolean) {
	const [access, setAccess] = useState<SegraModelAccess | null>(null);

	const refresh = useCallback(() => {
		desktopClient
			.invoke<{ catalog: SegraCatalog | null }>("segra_models")
			.then((result) => {
				const catalog = result?.catalog;
				if (!catalog?.data) return;
				setAccess({
					modelsUrl: catalog.segra_models_url ?? null,
					proUrl: catalog.segra_pro_url ?? null,
					byId: new Map(
						catalog.data.map((m) => [
							m.id,
							{
								name: m.name,
								description: m.description,
								pro: Boolean(m.segra_pro),
								available: m.segra_available !== false,
							},
						]),
					),
				});
			})
			.catch(() => undefined);
	}, []);

	useEffect(() => {
		if (!active) return;
		refresh();
		const unsubscribers = [
			desktopClient.subscribeTransportState((state) => {
				if (state === "connected") refresh();
			}),
			subscribeToProviderCatalogInvalidation(refresh),
		];
		return () => {
			for (const unsubscribe of unsubscribers) unsubscribe();
		};
	}, [active, refresh]);

	return { access: active ? access : null, refresh };
}

/** Segra's picker: models the account can use, then Pro models, labelled. */
export function applySegraAccess(
	picker: ModelPickerData,
	access: SegraModelAccess | null,
): ModelPickerData {
	if (!access) return picker;
	const options: SearchComboboxOption[] = picker.options.map((option) => {
		const info = access.byId.get(option.value);
		if (!info) return { ...option, section: "included" };
		return {
			...option,
			label: info.name?.trim() || option.label,
			badge: info.pro ? "Pro" : undefined,
			description: info.description,
			section: info.available ? "included" : "locked",
		};
	});
	const order = (o: SearchComboboxOption) => (o.section === "locked" ? 1 : 0);
	options.sort((a, b) => order(a) - order(b));
	const hasLocked = options.some((o) => o.section === "locked");
	return {
		options,
		sections: [
			{ id: "included", label: hasLocked ? "Your models" : "Models" },
			...(hasLocked
				? [
						{
							id: "locked",
							label: "Pro",
							description:
								"Need a paid account. Select one to see what it's good at.",
						},
					]
				: []),
		],
	};
}

/** True when the account can't use this Segra model (a Pro model on a free account). */
export function isLockedSegraModel(
	access: SegraModelAccess | null,
	modelId: string,
): boolean {
	return access?.byId.get(modelId)?.available === false;
}
