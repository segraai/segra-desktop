import { toast } from "@/hooks/use-toast";
import type { ChatMessageImage } from "@/lib/chat-schema";
import { desktopClient } from "@/lib/desktop-client";

type SaveImageResult =
	| { cancelled: true }
	| { path: string; fallback: boolean };

/**
 * Save as… for a chat image: the sidecar opens the system save dialog (or
 * saves to Downloads when there is none) and writes the file.
 */
export async function saveImageAs(
	image: ChatMessageImage,
	name = "image",
): Promise<void> {
	try {
		const result = await desktopClient.invoke<SaveImageResult>("save_image", {
			data: image.data,
			mediaType: image.mediaType,
			name,
		});
		if ("cancelled" in result) return;
		toast({
			title: "Image saved",
			description: result.fallback
				? `No save dialog was available, so it went to ${result.path}`
				: result.path,
		});
	} catch (error) {
		toast({
			title: "Couldn't save the image",
			description: error instanceof Error ? error.message : String(error),
			variant: "destructive",
		});
	}
}
