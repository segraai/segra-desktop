import { validateImageMedia } from "@cline/shared/browser";
import type { ChatMessageImage } from "@/lib/chat-schema";
import {
	isBinaryFile,
	isPdfFile,
	officeKind,
	officeToText,
	pdfToText,
} from "@/lib/document-text";
import { imageAttachmentMediaType } from "@/lib/image-attachments";
import type { SerializedAttachmentFile, SerializedAttachments } from "./types";

async function readFileAsDataUrl(file: File): Promise<string> {
	return await new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const value = typeof reader.result === "string" ? reader.result : "";
			resolve(value);
		};
		reader.onerror = () => {
			reject(reader.error ?? new Error("failed reading file"));
		};
		reader.readAsDataURL(file);
	});
}

// Keeps one message under MAX_DESKTOP_TRANSPORT_PAYLOAD_BYTES
// (webview/lib/voice-input-limits.ts): 24 MiB of originals is ~34 MB of base64.
export const MAX_ATTACHMENT_ORIGINAL_BYTES = 24 * 1024 * 1024;

async function readFileAsBase64(file: File): Promise<string> {
	const dataUrl = await readFileAsDataUrl(file);
	const comma = dataUrl.indexOf(",");
	return comma >= 0 ? dataUrl.slice(comma + 1) : "";
}

export async function serializeAttachments(
	files: File[],
): Promise<SerializedAttachments> {
	const userImages: string[] = [];
	const userFiles: SerializedAttachmentFile[] = [];
	let originalBytesUsed = 0;

	for (const file of files) {
		const mediaType = imageAttachmentMediaType(file);
		if (mediaType) {
			const dataUrl = await readFileAsDataUrl(
				new File([file], file.name, { type: mediaType }),
			);
			if (dataUrl) {
				userImages.push(dataUrl);
			}
			continue;
		}

		let content: string;
		const office = officeKind(file);
		if (office) {
			content = await officeToText(file, office).catch(
				(error: unknown) =>
					`[Segra Desktop could not read the attached file "${file.name}": ${error instanceof Error ? error.message : String(error)}. Ask the user to paste its contents instead.]`,
			);
		} else if (isPdfFile(file)) {
			content = await pdfToText(file).catch(
				(error: unknown) =>
					`[The attached PDF "${file.name}" could not be read: ${error instanceof Error ? error.message : String(error)}]`,
			);
		} else if (await isBinaryFile(file)) {
			// Say plainly that this is an app limitation, not a failed upload.
			content = `[The user attached "${file.name}". Segra Desktop can't read this file type yet (${file.type || "binary file"}), so only its name is included. The upload itself worked. Ask the user to paste the relevant contents, or to export it as PDF or text.]`;
		} else {
			content = await file.text();
		}
		let data: string | undefined;
		if (originalBytesUsed + file.size <= MAX_ATTACHMENT_ORIGINAL_BYTES) {
			data = (await readFileAsBase64(file).catch(() => "")) || undefined;
			if (data) originalBytesUsed += file.size;
		} else {
			const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
			content = `[The attached file "${file.name}" (${sizeMb} MB) was too large to attach in full. The user can open a session on its folder so it can be read directly.]\n${content}`;
		}
		userFiles.push(
			data ? { name: file.name, content, data } : { name: file.name, content },
		);
	}

	return { userImages, userFiles };
}

export function toChatMessageImages(
	userImages: string[],
	idPrefix: string,
): ChatMessageImage[] {
	const images: ChatMessageImage[] = [];
	for (const [index, value] of userImages.entries()) {
		const validation = validateImageMedia(undefined, value);
		if (!validation.ok) {
			continue;
		}
		images.push({
			id: `${idPrefix}_image_${index}`,
			mediaType: validation.mediaType,
			data: validation.base64,
		});
	}
	return images;
}
