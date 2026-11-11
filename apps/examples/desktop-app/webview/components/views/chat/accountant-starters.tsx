"use client";

import {
	FileSearch,
	FileSpreadsheet,
	FileText,
	type LucideIcon,
	Mail,
} from "lucide-react";
import {
	ACCOUNTANT_STARTERS,
	type AccountantStarter,
} from "@/lib/accountant-starters";

const STARTER_ICONS: Record<string, LucideIcon> = {
	"extract-client-documents": FileSpreadsheet,
	"read-cra-notice": FileSearch,
	"draft-document-request": Mail,
	"summarize-document": FileText,
};

/**
 * Four starting points for accountant mode. Selecting one only hands its
 * prompt to `onSelect`; it never sends a message.
 */
export function AccountantStarters({
	onSelect,
	className,
}: {
	onSelect: (prompt: string, starter: AccountantStarter) => void;
	className?: string;
}) {
	return (
		<section aria-label="Starting points" className={className}>
			<ul className="grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
				{ACCOUNTANT_STARTERS.map((starter) => {
					const Icon = STARTER_ICONS[starter.id] ?? FileText;
					return (
						<li className="min-w-0" key={starter.id}>
							<button
								className="flex h-full w-full cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-background/80 p-3 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								data-starter-id={starter.id}
								onClick={() => onSelect(starter.prompt, starter)}
								type="button"
							>
								<Icon
									aria-hidden="true"
									className="mt-0.5 size-4 shrink-0 text-muted-foreground"
								/>
								<span className="min-w-0">
									<span className="block text-sm font-medium text-foreground">
										{starter.title}
									</span>
									<span className="mt-0.5 block text-xs text-muted-foreground">
										{starter.description}
									</span>
								</span>
							</button>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
