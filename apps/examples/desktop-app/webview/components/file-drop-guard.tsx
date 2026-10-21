"use client";

import { Paperclip } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { desktopClient, isTauriAvailable } from "@/lib/desktop-client";

/** Window event carrying files dropped outside the composer, for it to attach. */
export const FILES_DROPPED_EVENT = "segra-files-dropped";

const MEDIA_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	pdf: "application/pdf",
};

function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

// The Tauri shell reports native drops as paths; the backend reads the bytes.
async function filesFromPaths(paths: string[]): Promise<File[]> {
	const files: File[] = [];
	for (const path of paths) {
		try {
			const { name, base64 } = await desktopClient.invoke<{
				name: string;
				base64: string;
			}>("read_dropped_file", { path });
			const extension = name.split(".").pop()?.toLowerCase() ?? "";
			files.push(
				new File([base64ToBytes(base64)], name, {
					type: MEDIA_TYPES[extension] ?? "",
				}),
			);
		} catch (error) {
			toast({
				variant: "destructive",
				title: "Could not attach a dropped file",
				description: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return files;
}

const dispatchFiles = (files: File[]) => {
	if (files.length === 0) return;
	window.dispatchEvent(
		new CustomEvent<File[]>(FILES_DROPPED_EVENT, { detail: files }),
	);
};

/**
 * Accepts file drags anywhere in the window: shows a "drop to attach" overlay
 * and hands dropped files to the composer. Without this, WebKit treats an
 * unhandled drop as "open this file", replacing the whole app with e.g. a PDF
 * (the Tauri shell also blocks file: navigation as a second line of defense).
 */
export function FileDropGuard() {
	const [dragging, setDragging] = useState(false);
	const depth = useRef(0);

	// Linux/macOS desktop: Tauri handles OS file drops natively (the webview
	// never sees them), so follow its drag-drop events instead.
	useEffect(() => {
		if (!isTauriAvailable()) return;
		let unlisten: (() => void) | undefined;
		let disposed = false;
		void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
			getCurrentWebview()
				.onDragDropEvent((event) => {
					const payload = event.payload;
					if (payload.type === "enter" || payload.type === "over") {
						setDragging(true);
					} else if (payload.type === "leave") {
						setDragging(false);
					} else {
						setDragging(false);
						void filesFromPaths(payload.paths).then(dispatchFiles);
					}
				})
				.then((fn) => {
					if (disposed) fn();
					else unlisten = fn;
				})
				.catch(() => undefined),
		);
		return () => {
			disposed = true;
			unlisten?.();
		};
	}, []);

	useEffect(() => {
		const hasFiles = (event: DragEvent) =>
			Array.from(event.dataTransfer?.types ?? []).includes("Files");
		const reset = () => {
			depth.current = 0;
			setDragging(false);
		};
		const onDragEnter = (event: DragEvent) => {
			if (!hasFiles(event)) return;
			event.preventDefault();
			depth.current += 1;
			setDragging(true);
		};
		// Accept the drag everywhere: WebKit opens a refused drop as a page.
		const onDragOver = (event: DragEvent) => {
			if (!hasFiles(event)) return;
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
		};
		const onDragLeave = (event: DragEvent) => {
			if (!hasFiles(event)) return;
			depth.current = Math.max(0, depth.current - 1);
			if (depth.current === 0) setDragging(false);
		};
		const onDrop = (event: DragEvent) => {
			if (!hasFiles(event)) return;
			const handled = event.defaultPrevented;
			event.preventDefault();
			reset();
			if (!handled) dispatchFiles(Array.from(event.dataTransfer?.files ?? []));
		};
		window.addEventListener("dragenter", onDragEnter);
		window.addEventListener("dragover", onDragOver);
		window.addEventListener("dragleave", onDragLeave);
		window.addEventListener("drop", onDrop);
		window.addEventListener("dragend", reset);
		return () => {
			window.removeEventListener("dragenter", onDragEnter);
			window.removeEventListener("dragover", onDragOver);
			window.removeEventListener("dragleave", onDragLeave);
			window.removeEventListener("drop", onDrop);
			window.removeEventListener("dragend", reset);
		};
	}, []);

	if (!dragging) return null;
	return (
		<div
			aria-hidden="true"
			className="pointer-events-none fixed inset-2 z-[100] flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/60 bg-primary/5 backdrop-blur-[1px]"
			data-file-drop-overlay
		>
			<p className="flex items-center gap-2 rounded-lg bg-background/90 px-4 py-2 text-sm font-medium text-foreground shadow-sm">
				<Paperclip className="size-4 text-primary" />
				Drop files to attach
			</p>
		</div>
	);
}
