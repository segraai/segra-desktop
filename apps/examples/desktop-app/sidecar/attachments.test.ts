import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	deleteMaterializedAttachments,
	discardAllTrackedAttachments,
	flushConsumedAttachments,
	markQueuedAttachmentsSubmitted,
	materializeUserFiles,
	reconcileQueuedAttachments,
	sessionAttachmentsDir,
	trackQueuedAttachments,
} from "./attachments";
import type { LiveSession } from "./types";

const sessionId = "attachment-test-session";
let previousSessionDataDir: string | undefined;
let testSessionDataDir: string;

function createSession(): LiveSession {
	return {
		config: {},
		messages: [],
		promptsInQueue: [],
		busy: false,
		startedAt: Date.now(),
		status: "idle",
	};
}

beforeEach(() => {
	previousSessionDataDir = process.env.CLINE_SESSION_DATA_DIR;
	testSessionDataDir = join(
		tmpdir(),
		`cline-desktop-attachment-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	process.env.CLINE_SESSION_DATA_DIR = testSessionDataDir;
});

afterEach(() => {
	if (previousSessionDataDir === undefined) {
		delete process.env.CLINE_SESSION_DATA_DIR;
	} else {
		process.env.CLINE_SESSION_DATA_DIR = previousSessionDataDir;
	}
	rmSync(testSessionDataDir, { recursive: true, force: true });
});

describe("materialized attachment lifecycle", () => {
	it("only deletes files inside the session attachments dir", () => {
		const [staged] = materializeUserFiles(sessionId, [
			{ name: "notes.txt", content: "hello" },
		]) as string[];
		const outside = join(testSessionDataDir, "outside.txt");
		writeFileSync(outside, "keep me", "utf8");

		deleteMaterializedAttachments(sessionId, [staged, outside]);

		expect(existsSync(staged)).toBe(false);
		expect(existsSync(outside)).toBe(true);
	});

	it("deletes consumed files when the turn ends", () => {
		const session = createSession();
		const files = materializeUserFiles(sessionId, [
			{ name: "a.txt", content: "a" },
		]) as string[];
		trackQueuedAttachments(
			session,
			[
				{
					id: "pending_1",
					prompt: "p",
					delivery: "queue",
					attachmentCount: 1,
					userFiles: files,
				},
			],
			files,
		);

		markQueuedAttachmentsSubmitted(session, "pending_1");
		expect(existsSync(files[0] as string)).toBe(true);

		flushConsumedAttachments(sessionId, session);
		expect(existsSync(files[0] as string)).toBe(false);
		expect(session.consumedAttachmentFiles?.size ?? 0).toBe(0);
	});

	it("keeps files for a submitted prompt that gets requeued", () => {
		const session = createSession();
		const files = materializeUserFiles(sessionId, [
			{ name: "a.txt", content: "a" },
		]) as string[];
		trackQueuedAttachments(
			session,
			[
				{
					id: "pending_1",
					prompt: "p",
					delivery: "queue",
					attachmentCount: 1,
					userFiles: files,
				},
			],
			files,
		);
		markQueuedAttachmentsSubmitted(session, "pending_1");

		// Drain send failed → prompt is back in the queue snapshot.
		reconcileQueuedAttachments(session, ["pending_1"]);
		flushConsumedAttachments(sessionId, session);
		expect(existsSync(files[0] as string)).toBe(true);
		expect(session.queuedAttachmentFiles?.get("pending_1")).toEqual(files);
	});

	it("tracks files as consumed when the prompt is no longer queued", () => {
		const session = createSession();
		const files = materializeUserFiles(sessionId, [
			{ name: "a.txt", content: "a" },
		]) as string[];

		trackQueuedAttachments(session, [], files);
		expect(session.queuedAttachmentFiles?.size ?? 0).toBe(0);
		expect(session.consumedAttachmentFiles?.size).toBe(1);
	});

	it("discards all tracked files on session end", () => {
		const session = createSession();
		const queued = materializeUserFiles(sessionId, [
			{ name: "queued.txt", content: "q" },
		]) as string[];
		const consumed = materializeUserFiles(sessionId, [
			{ name: "consumed.txt", content: "c" },
		]) as string[];
		trackQueuedAttachments(
			session,
			[
				{
					id: "pending_1",
					prompt: "p",
					delivery: "queue",
					attachmentCount: 1,
					userFiles: queued,
				},
			],
			queued,
		);
		trackQueuedAttachments(session, [], consumed);

		discardAllTrackedAttachments(sessionId, session);

		expect(existsSync(queued[0] as string)).toBe(false);
		expect(existsSync(consumed[0] as string)).toBe(false);
		expect(existsSync(sessionAttachmentsDir(sessionId))).toBe(true);
	});
});

describe("original attachment bytes", () => {
	const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x10]);

	it("saves originals and writes a .txt note pointing at them", () => {
		const [notePath] = materializeUserFiles(sessionId, [
			{
				name: "T4.pdf",
				content: "[Page 1: no text layer]",
				data: bytes.toString("base64"),
			},
		]) as string[];
		expect(notePath.endsWith(".txt")).toBe(true);
		const note = readFileSync(notePath, "utf8");
		const match = note.match(/saved at (.+?)\. To read/);
		expect(match).toBeTruthy();
		const originalPath = match?.[1] as string;
		expect(originalPath).toContain("originals");
		expect(originalPath.endsWith("T4.pdf")).toBe(true);
		expect(note).toContain("read_document");
		expect(note).toContain("\n\n[Page 1: no text layer]");
		expect(readFileSync(originalPath).equals(bytes)).toBe(true);

		deleteMaterializedAttachments(sessionId, [notePath]);
		expect(existsSync(notePath)).toBe(false);
		expect(existsSync(originalPath)).toBe(true);
	});

	it("handles files without data and invalid base64", () => {
		const paths = materializeUserFiles(sessionId, [
			{ name: "a.md", content: "hello" },
			{ name: "b.txt", content: "plain", data: "!!!" },
		]) as string[];
		expect(paths[0].endsWith("a.md.txt")).toBe(true);
		expect(readFileSync(paths[0], "utf8")).toBe("hello");
		expect(paths[1].endsWith("b.txt")).toBe(true);
		expect(readFileSync(paths[1], "utf8")).toBe("plain");
	});
});
