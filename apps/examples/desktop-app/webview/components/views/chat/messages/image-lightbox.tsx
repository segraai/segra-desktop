"use client";

import { Download, X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { ChatMessageImage } from "@/lib/chat-schema";
import { saveImageAs } from "@/lib/save-image";

/** Right-click → Save image as… on any chat image. */
export function ImageContextMenu({
	image,
	children,
}: {
	image: ChatMessageImage;
	children: ReactNode;
}) {
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
			{/* Above the full-window viewer (z-100). */}
			<ContextMenuContent className="z-[110] w-44">
				<ContextMenuItem onSelect={() => void saveImageAs(image)}>
					<Download />
					Save image as…
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}

/**
 * A chat image shown over the whole app window, with Save and Close. Esc or
 * a click outside the image closes it.
 */
export function ChatImageLightbox({
	image,
	onClose,
}: {
	image: ChatMessageImage;
	onClose: () => void;
}) {
	const closeRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		closeRef.current?.focus();
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onClose]);

	return createPortal(
		<div
			aria-label="Image viewer"
			aria-modal="true"
			className="fixed inset-0 z-[100] flex flex-col bg-background/95 backdrop-blur-sm"
			role="dialog"
		>
			<div className="relative z-10 flex shrink-0 items-center justify-end gap-2 p-3">
				<Button
					className="h-8 px-3 text-sm"
					onClick={() => void saveImageAs(image)}
					type="button"
					variant="outline"
				>
					<Download className="size-4" />
					Save
				</Button>
				<Button
					aria-label="Close image viewer"
					className="size-8 p-0"
					onClick={onClose}
					ref={closeRef}
					type="button"
					variant="ghost"
				>
					<X className="size-4" />
				</Button>
			</div>
			<div className="relative flex min-h-0 flex-1 items-center justify-center px-6 pb-6">
				<button
					aria-label="Close expanded image"
					className="absolute inset-0 cursor-zoom-out"
					onClick={onClose}
					tabIndex={-1}
					type="button"
				/>
				<ImageContextMenu image={image}>
					{/* biome-ignore lint/performance/noImgElement: In-memory data URLs do not have dimensions and cannot use Next's optimizer. */}
					<img
						alt="Expanded"
						className="relative max-h-full max-w-full rounded-lg object-contain shadow-2xl"
						src={`data:${image.mediaType};base64,${image.data}`}
					/>
				</ImageContextMenu>
			</div>
		</div>,
		document.body,
	);
}
