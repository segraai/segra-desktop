import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { SessionPendingPrompt } from "@cline/core";
import { sharedSessionDataDir } from "./paths";
import type { ChatTurnAttachments, LiveSession } from "./types";

function queuedFilesMap(session: LiveSession): Map<string, string[]> {
	if (!session.queuedAttachmentFiles) {
		session.queuedAttachmentFiles = new Map();
	}
	return session.queuedAttachmentFiles;
}

function consumedFilesMap(session: LiveSession): Map<string, string[]> {
	if (!session.consumedAttachmentFiles) {
		session.consumedAttachmentFiles = new Map();
	}
	return session.consumedAttachmentFiles;
}

// ---------------------------------------------------------------------------
// Materialized user-attachment lifecycle
//
// Non-image attachments arrive from the webview as inline content and are
// written to `<session-data>/<sessionId>/user-attachments/` so the SDK can
// load them by path at turn start. The sidecar owns these files and must
// delete them once consumed (turn completed) or discarded (queued prompt
// removed / session ended) — otherwise user data accumulates on disk.
// ---------------------------------------------------------------------------

export function sessionAttachmentsDir(sessionId: string): string {
	return join(sharedSessionDataDir(), sessionId, "user-attachments");
}

export function materializeUserFiles(
	sessionId: string,
	files: ChatTurnAttachments["userFiles"],
): string[] | undefined {
	if (!files?.length) {
		return undefined;
	}
	const attachmentDir = sessionAttachmentsDir(sessionId);
	mkdirSync(attachmentDir, { recursive: true });
	return files.map((file) => {
		const requestedName = basename(file.name.trim());
		const safeName =
			requestedName && requestedName !== "." && requestedName !== ".."
				? requestedName
				: "attachment.txt";
		const id = randomUUID();
		let body = file.content;
		const originalPath = saveOriginal(sessionId, id, safeName, file.data);
		if (originalPath) {
			body = `The user attached "${file.name}". The original file is saved at ${originalPath}. To read scanned pages or images, or to re-read it, call read_document with that path.\n\n${file.content}`;
		}
		// Always a .txt note so core never sees a fake binary extension.
		const noteName = safeName.toLowerCase().endsWith(".txt")
			? safeName
			: `${safeName}.txt`;
		const path = join(attachmentDir, `${id}-${noteName}`);
		writeFileSync(path, body, "utf8");
		return path;
	});
}

/**
 * Save the original bytes under `<session>/originals/<id>/<name>`. Originals
 * are outside user-attachments, so per-turn cleanup never touches them; they
 * go away with the session data folder. Returns undefined if nothing saved.
 */
function saveOriginal(
	sessionId: string,
	id: string,
	safeName: string,
	data: string | undefined,
): string | undefined {
	if (!data) return undefined;
	try {
		const bytes = Buffer.from(data, "base64");
		if (bytes.length === 0) return undefined;
		const dir = join(sharedSessionDataDir(), sessionId, "originals", id);
		mkdirSync(dir, { recursive: true });
		const path = join(dir, safeName);
		writeFileSync(path, bytes);
		return resolve(path);
	} catch {
		return undefined;
	}
}

/**
 * Delete materialized attachment files. Only paths inside the session's
 * user-attachments directory are removed, so files referenced from elsewhere
 * (e.g. `@`-mentions) are never touched.
 */
export function deleteMaterializedAttachments(
	sessionId: string,
	paths: string[] | undefined,
): void {
	if (!paths?.length) return;
	const attachmentDir = resolve(sessionAttachmentsDir(sessionId)) + sep;
	for (const path of paths) {
		if (!resolve(path).startsWith(attachmentDir)) continue;
		try {
			rmSync(path, { force: true });
		} catch {
			// Best-effort cleanup; leftover files are removed with the session dir.
		}
	}
}

/**
 * Track files staged for a queued/steered prompt so they can be deleted once
 * the prompt is consumed or discarded. If the prompt is no longer in the
 * queue (already submitted), the files are tracked as consumed and deleted
 * when the running turn finishes.
 */
export function trackQueuedAttachments(
	session: LiveSession | undefined,
	prompts: SessionPendingPrompt[],
	userFiles: string[] | undefined,
): void {
	if (!session || !userFiles?.length) return;
	const match = prompts.find((prompt) =>
		isDeepStrictEqual(prompt.userFiles, userFiles),
	);
	if (match) {
		queuedFilesMap(session).set(match.id, userFiles);
	} else {
		// Not in the queue → already being consumed by the running turn. Key by a
		// fresh id so it never collides with a prompt-id key used elsewhere in the
		// consumed bucket.
		consumedFilesMap(session).set(randomUUID(), userFiles);
	}
}

/** Move a submitted queued prompt's files into the consumed bucket. */
export function markQueuedAttachmentsSubmitted(
	session: LiveSession | undefined,
	promptId: string,
): void {
	const files = session?.queuedAttachmentFiles?.get(promptId);
	if (!session || !files) return;
	session.queuedAttachmentFiles?.delete(promptId);
	consumedFilesMap(session).set(promptId, files);
}

/**
 * A prompt id reappearing in the queue means a submitted prompt was requeued
 * (e.g. the drain send failed) — move its files back to the queued bucket so
 * the turn-end flush does not delete files still pending consumption.
 */
export function reconcileQueuedAttachments(
	session: LiveSession | undefined,
	queuedPromptIds: string[],
): void {
	if (!session?.consumedAttachmentFiles?.size) return;
	for (const id of queuedPromptIds) {
		const files = session.consumedAttachmentFiles.get(id);
		if (!files) continue;
		session.consumedAttachmentFiles.delete(id);
		queuedFilesMap(session).set(id, files);
	}
}

/** Delete files for prompts whose turn has finished. */
export function flushConsumedAttachments(
	sessionId: string,
	session: LiveSession | undefined,
): void {
	if (!session?.consumedAttachmentFiles?.size) return;
	for (const files of session.consumedAttachmentFiles.values()) {
		deleteMaterializedAttachments(sessionId, files);
	}
	session.consumedAttachmentFiles.clear();
}

/** Delete every tracked file for a session (queued prompts are discarded). */
export function discardAllTrackedAttachments(
	sessionId: string,
	session: LiveSession | undefined,
): void {
	if (!session) return;
	flushConsumedAttachments(sessionId, session);
	if (!session.queuedAttachmentFiles?.size) return;
	for (const files of session.queuedAttachmentFiles.values()) {
		deleteMaterializedAttachments(sessionId, files);
	}
	session.queuedAttachmentFiles.clear();
}
