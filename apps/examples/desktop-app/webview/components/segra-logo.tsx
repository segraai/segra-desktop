import { AgentWelcomeHero } from "@cline/ui";
import { cn } from "@/lib/utils";

/** The Segra mark (public/segra-logo.png), sized by className. */
export function SegraLogo({ className }: { className?: string }) {
	return (
		// biome-ignore lint/performance/noImgElement: static export, no next/image optimizer
		<img
			alt=""
			aria-hidden="true"
			className={cn("inline-block shrink-0 object-contain", className)}
			draggable={false}
			src="/segra-logo.png"
		/>
	);
}

/**
 * Welcome illustration: the Segra mark in the same 220px box the upstream
 * hero uses, optionally over its grid backdrop.
 */
export function SegraWelcomeHero({ grid = true }: { grid?: boolean }) {
	return (
		<div className="relative h-[220px]">
			{grid ? (
				<AgentWelcomeHero interactive={false} variant="grid-only" />
			) : null}
			<SegraLogo className="absolute top-6 left-1/2 size-[150px] -translate-x-1/2" />
		</div>
	);
}
