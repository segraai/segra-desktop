"use client";

import {
	CloudOff,
	HardDrive,
	type LucideIcon,
	Radio,
	ShieldCheck,
	TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { EXTENSIONS_NOTE } from "@/lib/privacy";
import { cn } from "@/lib/utils";
import { PageFrame, PageHeader } from "../page-layout";

type Item = { title: string; body: ReactNode };

/**
 * Settings → Privacy: every way data can leave this computer, in plain words.
 * Each line must stay literally true; see lib/privacy.ts for the sources.
 */
const SECTIONS: {
	icon: LucideIcon;
	tone: string;
	title: string;
	intro: string;
	items: Item[];
}[] = [
	{
		icon: HardDrive,
		tone: "text-primary",
		title: "Stays on this computer",
		intro: "Stored and handled here. Nothing below is uploaded anywhere.",
		items: [
			{
				title: "Models on this computer",
				body: "With a model from On this computer, the AI itself runs here too. Your messages and files never leave this computer, and it works offline.",
			},
			{
				title: "Chats and history",
				body: "Every conversation is saved in Segra Desktop's folder on this computer. There is no cloud copy.",
			},
			{
				title: "Your files and projects",
				body: "The agent reads, searches and edits them right here. Only the parts it reads go to the model (see below).",
			},
			{
				title: "Commands",
				body: "Commands the agent runs, run on this computer, or on your own SSH host if you work there.",
			},
			{
				title: "Settings, keys and sign-in",
				body: "API keys and your Segra sign-in are stored on this computer.",
			},
			{
				title: "Privacy checks",
				body: "The results of the provider and reply checks are saved here, as hashes and addresses only, never content.",
			},
		],
	},
	{
		icon: ShieldCheck,
		tone: "text-primary",
		title: "Sent to the model, privately",
		intro:
			"When you chat with Segra, this is the only place your words and files go.",
		items: [
			{
				title: "Straight to the model's secure hardware",
				body: "Your message, the conversation so far and the parts of files the agent reads go directly from this computer to the model's provider on the 0G network. They never pass through Segra's servers.",
			},
			{
				title: "Checked before anything is sent",
				body: "Before the first message, this computer checks the provider itself: Intel's signature on its secure-hardware (TEE) report, the software running inside, and that the model runs inside that hardware. If any check fails, nothing is sent.",
			},
			{
				title: "Every reply is verified",
				body: "Each reply is signed inside that hardware, and this computer checks the signature against exactly the reply it received. That's the Verified badge next to the model.",
			},
			{
				title: "What Segra's server sees",
				body: "Your account, which model you used and how many tokens, for billing. Never your messages, files or replies.",
			},
		],
	},
	{
		icon: TriangleAlert,
		tone: "text-amber-600 dark:text-amber-400",
		title: "Leaves this computer when you use it",
		intro:
			"These run from this computer, but by their nature someone outside sees part of what happens. The chat shows a note when one is used.",
		items: [
			{
				title: "Web search",
				body: "Searches run from this computer on DuckDuckGo, not through an AI company. DuckDuckGo sees the search terms (written by the model from your chat) and your internet address, like any search you type.",
			},
			{
				title: "Opening web pages",
				body: "The website sees the visit and your internet address, like opening the page in your browser.",
			},
			{
				title: "MCP servers and plugins",
				body: EXTENSIONS_NOTE,
			},
			{
				title: "Commands that use the internet",
				body: "Commands like git push or npm install contact those services, the same as in your own terminal.",
			},
			{
				title: "Voice input",
				body: "Recordings go to the voice provider you choose in Settings → Voice, which hears them. Voice doesn't go through the secure hardware.",
			},
			{
				title: "Other model providers",
				body: "If you pick a provider other than Segra, your messages and files go to that company's servers, which can read and keep them. The model picker then shows Not private. Models you run at a local address (Ollama, LM Studio) show On this computer.",
			},
			{
				title: "Send feedback",
				body: "Only what you type in the feedback box goes to the Segra team, never your chats.",
			},
		],
	},
	{
		icon: Radio,
		tone: "text-muted-foreground",
		title: "Background connections",
		intro: "These never carry your chats or files.",
		items: [
			{
				title: "Sign-in and billing",
				body: "Segra's server (web.segra.ai): signing in, starting a model session, and your balance.",
			},
			{
				title: "Provider checks",
				body: "The public 0G network, to read the provider's registration, and Phala's certificate service, for Intel's certificates used in the hardware check.",
			},
			{
				title: "Updates and Marketplace",
				body: "GitHub, to check for app updates and to load the Marketplace list.",
			},
			{
				title: "Downloading local models",
				body: "Hugging Face, once per model, to download its file. Nothing about your chats is sent.",
			},
		],
	},
];

export function PrivacyContent() {
	return (
		<PageFrame>
			<PageHeader
				description="Your chats and files stay on this computer. With a model on this computer, the AI runs here too. With Segra, what the AI needs to read goes only to sealed, secure hardware this computer checks first, where not even Segra can see it."
				title="Privacy"
			/>
			<p className="-mt-4 mb-8 flex max-w-2xl items-start gap-2 text-sm text-muted-foreground">
				<CloudOff aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
				<span>
					No telemetry, analytics or crash reports. Segra Desktop doesn't report
					what you do.
				</span>
			</p>
			<div className="flex max-w-3xl flex-col gap-8">
				{SECTIONS.map((section) => (
					<section aria-label={section.title} key={section.title}>
						<h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
							<section.icon
								aria-hidden="true"
								className={cn("size-5 shrink-0", section.tone)}
							/>
							{section.title}
						</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							{section.intro}
						</p>
						<dl className="mt-3 divide-y rounded-lg border">
							{section.items.map((item) => (
								<div className="px-4 py-3" key={item.title}>
									<dt className="text-sm font-medium text-foreground">
										{item.title}
									</dt>
									<dd className="mt-0.5 text-sm text-muted-foreground">
										{item.body}
									</dd>
								</div>
							))}
						</dl>
					</section>
				))}
			</div>
		</PageFrame>
	);
}
