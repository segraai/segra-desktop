"use client";

import { ShieldCheck } from "lucide-react";
import { openSettingsSection, PRIVATE_PROMISE } from "@/lib/privacy";

/** Shown above the composer on a new Segra chat: what happens to their work. */
export function WelcomePrivacyNotice() {
	return (
		<p className="mt-6 flex items-start gap-2 px-1 text-[13px] text-muted-foreground">
			<ShieldCheck
				aria-hidden="true"
				className="mt-0.5 size-4 shrink-0 text-primary"
			/>
			<span>
				{PRIVATE_PROMISE}{" "}
				<button
					className="font-medium text-primary hover:underline"
					onClick={() => openSettingsSection("Privacy")}
					type="button"
				>
					How it works
				</button>
			</span>
		</p>
	);
}
