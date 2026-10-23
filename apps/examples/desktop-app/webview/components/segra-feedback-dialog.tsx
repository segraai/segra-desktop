"use client";

import { Loader2, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { desktopClient } from "@/lib/desktop-client";

interface SentMessage {
	id: number;
	message: string;
	createdAt: number;
}

/**
 * Segra Desktop's "Send feedback" box: testers type anything and it goes to
 * the Segra team (the sidecar's `segra_feedback` → `{segra}/feedback`). They
 * see what they've sent. Only what they type is sent, never chat content.
 */
export function SegraFeedbackDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [messages, setMessages] = useState<SentMessage[]>([]);
	const [signedIn, setSignedIn] = useState(true);
	const [draft, setDraft] = useState("");
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const listRef = useRef<HTMLDivElement>(null);

	const load = useCallback(() => {
		desktopClient
			.invoke<{ signedIn: boolean; messages?: SentMessage[] }>(
				"segra_feedback",
				{ action: "list" },
			)
			.then((result) => {
				setSignedIn(result?.signedIn !== false);
				setMessages(result?.messages ?? []);
			})
			.catch((e) => setError(e instanceof Error ? e.message : String(e)));
	}, []);

	useEffect(() => {
		if (open) {
			setError(null);
			load();
		}
	}, [open, load]);

	// Newest at the bottom, like a chat; keep it scrolled there.
	const ordered = [...messages].reverse();
	useEffect(() => {
		listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
	}, [ordered.length]);

	const send = async () => {
		const message = draft.trim();
		if (!message || sending) return;
		setSending(true);
		setError(null);
		try {
			await desktopClient.invoke("segra_feedback", { action: "send", message });
			setDraft("");
			load();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setSending(false);
		}
	};

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="flex max-h-[80vh] flex-col sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Send feedback</DialogTitle>
					<DialogDescription>
						Tell us anything: what worked, what didn&apos;t, what you&apos;d
						like. It goes straight to the Segra team. Your chats are never
						included.
					</DialogDescription>
				</DialogHeader>

				{signedIn ? (
					<>
						<div
							className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto rounded-md border bg-muted/30 p-3"
							ref={listRef}
						>
							{ordered.length === 0 ? (
								<p className="m-auto text-sm text-muted-foreground">
									Nothing sent yet.
								</p>
							) : (
								ordered.map((m) => (
									<div className="ml-auto max-w-[85%]" key={m.id}>
										<p className="rounded-lg bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
											{m.message}
										</p>
										<p className="mt-0.5 text-right text-[11px] text-muted-foreground">
											{new Date(m.createdAt).toLocaleString()}
										</p>
									</div>
								))
							)}
						</div>
						<div className="flex items-end gap-2">
							<Textarea
								aria-label="Feedback message"
								className="max-h-40 min-h-16 flex-1 resize-none"
								onChange={(e) => setDraft(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && !e.shiftKey) {
										e.preventDefault();
										void send();
									}
								}}
								placeholder="Type your feedback… (Enter to send, Shift+Enter for a new line)"
								value={draft}
							/>
							<Button
								aria-label="Send"
								disabled={!draft.trim() || sending}
								onClick={() => void send()}
								size="icon"
								type="button"
							>
								{sending ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Send className="size-4" />
								)}
							</Button>
						</div>
					</>
				) : (
					<p className="text-sm text-muted-foreground">
						Sign in with Segra (Settings → Providers) to send feedback.
					</p>
				)}
				{error ? (
					<p className="text-sm text-destructive" role="alert">
						{error}
					</p>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
