"use client";

import { SessionStatus } from "@cline/ui";
import {
	ArrowUpDown,
	Check,
	ChevronLeft,
	ChevronRight,
	ChevronsLeft,
	Cloud,
	Filter,
	Folder,
	GitFork,
	Import,
	Loader2,
	MoreHorizontal,
	Pencil,
	Pin,
	Search,
	Trash2,
	X,
} from "lucide-react";
import {
	type CSSProperties,
	type MouseEvent as ReactMouseEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { ImportSessionsDialog } from "@/components/import-sessions-dialog";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
	basenamePath,
	formatCostUsd,
	formatRelativeTime,
	type SessionThread,
	sessionActivityTimestamp,
	type UseSessionHistoryResult,
} from "@/hooks/use-session-history";
import { toast } from "@/hooks/use-toast";
import type { SessionHistoryItem } from "@/lib/session-history";
import { sessionStatusColor, sessionStatusTone } from "@/lib/session-status";
import { cn } from "@/lib/utils";
import { TASK_WORKTREE_DELETE_WARNING } from "@/lib/work-in-selection";
import { isTaskWorktreePath } from "@/lib/workspace-paths";

type SessionsViewProps = {
	activeSessionId?: string | null;
	history: UseSessionHistoryResult;
};

const PAGE_SIZE = 10;

const BULK_TASK_WORKTREE_DELETE_WARNING =
	"Some of these sessions ran in their own git worktrees. Deleting them also removes those worktrees and their generated branches, including any uncommitted changes in them.";

// Radix renders the check icon for the indeterminate state too, so swap it
// for a dash. The shared Checkbox has no indeterminate styling of its own.
const INDETERMINATE_CHECKBOX_CLASS =
	"data-[state=indeterminate]:relative data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:[&_svg]:hidden data-[state=indeterminate]:after:absolute data-[state=indeterminate]:after:inset-x-[3px] data-[state=indeterminate]:after:top-1/2 data-[state=indeterminate]:after:h-0.5 data-[state=indeterminate]:after:-translate-y-1/2 data-[state=indeterminate]:after:rounded data-[state=indeterminate]:after:bg-primary-foreground";

function modelLabel(thread: SessionThread): string {
	if (thread.provider && thread.model) {
		return `${thread.provider}:${thread.model}`;
	}
	return thread.model || thread.provider || "No model";
}

export function formatCompactTokens(value: number): string {
	if (!Number.isFinite(value) || value < 0) {
		return "0";
	}
	if (value >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(1)}m`;
	}
	if (value >= 1_000) {
		return `${(value / 1_000).toFixed(1)}k`;
	}
	return `${value}`;
}

const MAX_PAGE_BUTTONS = 7;

/**
 * Page buttons for a 1-indexed pager: every page while the list is short, and
 * first/last plus a window around the current page once it grows.
 */
export function paginationItems(
	currentPage: number,
	pageCount: number,
): Array<number | "gap-start" | "gap-end"> {
	if (pageCount <= MAX_PAGE_BUTTONS) {
		return Array.from({ length: pageCount }, (_, index) => index + 1);
	}
	const windowStart = Math.max(
		2,
		Math.min(currentPage - 1, pageCount - MAX_PAGE_BUTTONS + 3),
	);
	const windowEnd = Math.min(
		pageCount - 1,
		Math.max(currentPage + 1, MAX_PAGE_BUTTONS - 2),
	);
	const items: Array<number | "gap-start" | "gap-end"> = [1];
	if (windowStart > 2) {
		items.push("gap-start");
	}
	for (let page = windowStart; page <= windowEnd; page += 1) {
		items.push(page);
	}
	if (windowEnd < pageCount - 1) {
		items.push("gap-end");
	}
	items.push(pageCount);
	return items;
}

function tokensLabel(thread: SessionThread): string {
	if (thread.inputTokens == null && thread.outputTokens == null) {
		return "-";
	}
	const input = formatCompactTokens(thread.inputTokens ?? 0);
	const output = formatCompactTokens(thread.outputTokens ?? 0);
	return `${input}/${output}`;
}

function sessionFilterDetails(
	thread: SessionThread,
	session?: SessionHistoryItem,
): string[] {
	const workspacePath = session?.workspaceRoot || session?.cwd || "";
	const workspace = workspacePath ? basenamePath(workspacePath) : "";
	return [
		thread.origin === "cloud" ? "location:cloud" : undefined,
		thread.pinned ? "pinned:yes" : undefined,
		workspace ? `workspace:${workspace}` : undefined,
		thread.status ? `status:${thread.status}` : undefined,
		thread.provider ? `provider:${thread.provider}` : undefined,
		thread.model ? `model:${thread.model}` : undefined,
	].filter((detail): detail is string => Boolean(detail));
}

function sortTimestamp(session?: SessionHistoryItem) {
	if (!session) {
		return 0;
	}
	const timestamp = sessionActivityTimestamp(session);
	return Number.isFinite(timestamp) ? timestamp : 0;
}

export function SessionsView({ activeSessionId, history }: SessionsViewProps) {
	const [query, setQuery] = useState("");
	const [sessionFilters, setSessionFilters] = useState<string[]>([]);
	const [sortDirection, setSortDirection] = useState<"newest" | "oldest">(
		"newest",
	);
	const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
	const [editingTitle, setEditingTitle] = useState("");
	const [importDialogOpen, setImportDialogOpen] = useState(false);
	const [deleteCandidate, setDeleteCandidate] = useState<SessionThread | null>(
		null,
	);
	const [page, setPage] = useState(0);
	const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	// Frozen at the moment "Delete" is clicked so the dialog wording and the
	// progress total stay stable while rows disappear underneath it.
	const [bulkCandidates, setBulkCandidates] = useState<SessionThread[] | null>(
		null,
	);
	const [bulkProgress, setBulkProgress] = useState<{
		current: number;
		total: number;
	} | null>(null);
	const lastClickedIdRef = useRef<string | null>(null);
	const requiresCompleteHistory =
		query.trim().length > 0 ||
		sessionFilters.length > 0 ||
		sortDirection === "oldest";

	useEffect(() => {
		if (!requiresCompleteHistory || !history.mayHaveMoreSessions) {
			return;
		}
		void history.loadAllSessions();
	}, [
		history.loadAllSessions,
		history.mayHaveMoreSessions,
		requiresCompleteHistory,
	]);

	const filterOptions = useMemo(
		() =>
			Array.from(
				new Set(
					history.threads.flatMap((thread) =>
						sessionFilterDetails(thread, history.sessionById.get(thread.id)),
					),
				),
			).sort((a, b) => a.localeCompare(b)),
		[history.sessionById, history.threads],
	);

	const filteredThreads = useMemo(() => {
		const normalizedQuery = query.trim().toLowerCase();
		const selected = new Set(sessionFilters);
		const filtered = history.threads.filter((thread) => {
			const session = history.sessionById.get(thread.id);
			const details = sessionFilterDetails(thread, session);
			const matchesFilters =
				selected.size === 0 || details.some((detail) => selected.has(detail));
			if (!matchesFilters) {
				return false;
			}
			if (!normalizedQuery) {
				return true;
			}
			const searchable = [
				thread.title,
				thread.codebase,
				thread.provider,
				thread.model,
				thread.repoUrl,
				session?.workspaceRoot,
				session?.cwd,
			]
				.filter(Boolean)
				.join(" ")
				.toLowerCase();
			return searchable.includes(normalizedQuery);
		});
		return [...filtered].sort((a, b) => {
			const aTime = sortTimestamp(history.sessionById.get(a.id));
			const bTime = sortTimestamp(history.sessionById.get(b.id));
			return sortDirection === "newest" ? bTime - aTime : aTime - bTime;
		});
	}, [
		history.sessionById,
		history.threads,
		query,
		sessionFilters,
		sortDirection,
	]);

	const pageCount = Math.max(1, Math.ceil(filteredThreads.length / PAGE_SIZE));
	const currentPage = Math.min(page, pageCount - 1);
	const pageStart = currentPage * PAGE_SIZE;
	const visibleThreads = useMemo(
		() => filteredThreads.slice(pageStart, pageStart + PAGE_SIZE),
		[filteredThreads, pageStart],
	);
	const canGoNext =
		currentPage + 1 < pageCount ||
		(history.mayHaveMoreSessions && !requiresCompleteHistory);

	// Tokens and cost are not part of the discovery rows; the hook reads them
	// from each transcript on demand, so tell it which rows are on screen.
	// Paging (or a fresh batch of older sessions) changes the visible rows and
	// the new page fills in the same way.
	useEffect(() => {
		history.requestUsage(visibleThreads.map((thread) => thread.id));
	}, [history.requestUsage, visibleThreads]);
	// Leaving the view releases its page, so running sessions on it stop being
	// re-read while nobody is looking at them. Separate from the effect above
	// on purpose: a per-change cleanup would clear and re-set the same ids and
	// restart the hook's hydration each time a row filled in.
	useEffect(
		() => () => {
			history.requestUsage([]);
		},
		[history.requestUsage],
	);

	// Selection is by session id and only ever holds rows on the visible page:
	// drop ids that were deleted elsewhere or moved off the page.
	useEffect(() => {
		setSelectedIds((current) => {
			if (current.size === 0) {
				return current;
			}
			const visible = new Set(visibleThreads.map((thread) => thread.id));
			const next = new Set([...current].filter((id) => visible.has(id)));
			return next.size === current.size ? current : next;
		});
	}, [visibleThreads]);

	// Snap back when a page disappears (filters changed, or "next" asked the
	// backend for older sessions and there were none left).
	useEffect(() => {
		setPage((current) => Math.min(current, pageCount - 1));
	}, [pageCount]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: restart paging whenever the result set changes
	useEffect(() => {
		setPage(0);
		setSelectedIds(new Set());
		lastClickedIdRef.current = null;
	}, [query, sessionFilters, sortDirection]);

	const changePage = (nextPage: number) => {
		// Selection never carries across pages, so "Delete" always acts on rows
		// the user can see.
		setSelectedIds(new Set());
		lastClickedIdRef.current = null;
		setPage(nextPage);
	};

	const goToNextPage = async () => {
		const nextPage = currentPage + 1;
		if (
			nextPage >= pageCount &&
			history.mayHaveMoreSessions &&
			!requiresCompleteHistory
		) {
			// Only page boundaries hit the backend; the mount fetch stays small.
			// Stay put when the fetch fails so the user keeps the page they can
			// see and the same click retries.
			if (!(await history.loadOlderSessions())) {
				return;
			}
		}
		changePage(nextPage);
	};

	const toggleFilter = (detail: string, checked: boolean) => {
		setSessionFilters((current) => {
			if (checked) {
				return current.includes(detail) ? current : [...current, detail];
			}
			return current.filter((item) => item !== detail);
		});
	};

	const openRow = (thread: SessionThread) => {
		if (history.pendingAction?.sessionId === thread.id) {
			return;
		}
		// Don't open the session when the click only finished a text selection.
		if (window.getSelection()?.toString()) {
			return;
		}
		history.openThread(thread.id);
	};

	const startRename = (thread: SessionThread) => {
		setEditingSessionId(thread.id);
		setEditingTitle(thread.title);
	};

	const cancelRename = () => {
		setEditingSessionId(null);
		setEditingTitle("");
	};

	const submitRename = async (thread: SessionThread) => {
		const renamed = await history.renameThread(thread.id, editingTitle);
		if (renamed) {
			cancelRename();
		}
	};

	const confirmDelete = async () => {
		if (!deleteCandidate) {
			return;
		}
		const deleted = await history.deleteThread(deleteCandidate.id);
		if (deleted) {
			setDeleteCandidate(null);
		}
	};

	const selectedThreads = visibleThreads.filter((thread) =>
		selectedIds.has(thread.id),
	);
	const allOnPageSelected =
		visibleThreads.length > 0 &&
		selectedThreads.length === visibleThreads.length;
	const isBulkDeleting = bulkProgress !== null;

	const toggleAllOnPage = () => {
		lastClickedIdRef.current = null;
		setSelectedIds(
			allOnPageSelected
				? new Set()
				: new Set(visibleThreads.map((thread) => thread.id)),
		);
	};

	const toggleRowSelection = (id: string, shiftKey: boolean) => {
		const anchorId = lastClickedIdRef.current;
		const anchorIndex = anchorId
			? visibleThreads.findIndex((thread) => thread.id === anchorId)
			: -1;
		const index = visibleThreads.findIndex((thread) => thread.id === id);
		setSelectedIds((current) => {
			const next = new Set(current);
			if (shiftKey && anchorIndex >= 0 && index >= 0) {
				const from = Math.min(anchorIndex, index);
				const to = Math.max(anchorIndex, index);
				for (const thread of visibleThreads.slice(from, to + 1)) {
					next.add(thread.id);
				}
			} else if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
		lastClickedIdRef.current = id;
	};

	const confirmBulkDelete = async () => {
		if (!bulkCandidates || isBulkDeleting) {
			return;
		}
		const candidates = bulkCandidates;
		const failedIds: string[] = [];
		let deletedCount = 0;
		// One at a time through the normal delete path so every per-session side
		// effect still runs. The hook's pendingAction is a single slot, so
		// concurrent calls would race on it.
		for (const [index, candidate] of candidates.entries()) {
			setBulkProgress({ current: index + 1, total: candidates.length });
			let deleted = false;
			try {
				deleted = Boolean(await history.deleteThread(candidate.id));
			} catch {
				deleted = false;
			}
			if (deleted) {
				deletedCount += 1;
			} else {
				failedIds.push(candidate.id);
			}
		}
		setBulkProgress(null);
		setBulkCandidates(null);
		lastClickedIdRef.current = null;
		setSelectedIds(new Set(failedIds));
		const noun = (count: number) => (count === 1 ? "session" : "sessions");
		if (failedIds.length === 0) {
			toast({
				title: `Deleted ${deletedCount} ${noun(deletedCount)}`,
			});
		} else {
			toast({
				variant: "destructive",
				title: `Deleted ${deletedCount} of ${candidates.length} ${noun(candidates.length)}`,
				description: `${failedIds.length} could not be deleted and ${failedIds.length === 1 ? "is" : "are"} still selected.`,
			});
		}
	};

	const bulkCount = bulkCandidates?.length ?? 0;
	const bulkHasCloud = bulkCandidates?.some(
		(thread) => thread.origin === "cloud",
	);
	const bulkHasWorktree = bulkCandidates?.some(
		(thread) =>
			thread.origin !== "cloud" &&
			isTaskWorktreePath(thread.workspacePath ?? ""),
	);

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
			<header className="flex shrink-0 items-end justify-between gap-6 px-18 pb-7 pt-10 max-[1200px]:px-8 max-md:pl-12 max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:pr-4 max-[720px]:pt-5">
				<div className="min-w-0">
					<h1 className="text-3xl font-semibold">Sessions</h1>
					<p className="mt-3 text-base leading-6 text-muted-foreground">
						Recent sessions across clients and workspaces.
					</p>
				</div>
				<div className="flex min-w-0 items-center gap-2">
					<div className="relative min-w-44 max-w-72 flex-1">
						<Search className="-translate-y-1/2 pointer-events-none absolute left-2.5 top-1/2 size-4 text-muted-foreground" />
						<Input
							aria-label="Search sessions"
							className="h-8 pl-8"
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search"
							value={query}
						/>
					</div>
					<Button
						aria-label="Import sessions from other tools"
						className="h-8 rounded-md px-2.5"
						onClick={() => setImportDialogOpen(true)}
						size="sm"
						title="Import sessions from Claude Code, Codex, or opencode"
						type="button"
						variant="outline"
					>
						<Import className="size-4" />
						Import
					</Button>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								aria-label="Sort sessions"
								className="h-8 rounded-md px-2.5"
								size="sm"
								title="Sort sessions"
								type="button"
								variant="outline"
							>
								<ArrowUpDown className="size-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" sideOffset={6}>
							<DropdownMenuItem onClick={() => setSortDirection("newest")}>
								Newest first
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => setSortDirection("oldest")}>
								Oldest first
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<DropdownMenu
						onOpenChange={(open) => {
							// Filter choices are derived from the loaded rows, so
							// complete the history as soon as the user opens this
							// menu. This keeps both the options and their results
							// global rather than limited to the newest batch.
							if (open && history.mayHaveMoreSessions) {
								void history.loadAllSessions();
							}
						}}
					>
						<DropdownMenuTrigger asChild>
							<Button
								aria-label="Filter sessions"
								className="h-8 rounded-md px-2.5"
								size="sm"
								title="Filter sessions"
								type="button"
								variant={sessionFilters.length > 0 ? "default" : "outline"}
							>
								<Filter className="size-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="max-h-72 w-72">
							<DropdownMenuGroup>
								<DropdownMenuLabel>Filter sessions</DropdownMenuLabel>
								{sessionFilters.length > 0 ? (
									<>
										<DropdownMenuItem onClick={() => setSessionFilters([])}>
											Clear filters
										</DropdownMenuItem>
										<DropdownMenuSeparator />
									</>
								) : null}
								{filterOptions.length === 0 ? (
									<DropdownMenuItem disabled>
										No filters available
									</DropdownMenuItem>
								) : (
									filterOptions.map((detail) => (
										<DropdownMenuCheckboxItem
											checked={sessionFilters.includes(detail)}
											key={detail}
											onCheckedChange={(checked) =>
												toggleFilter(detail, checked === true)
											}
										>
											<span className="truncate" title={detail}>
												{detail}
											</span>
										</DropdownMenuCheckboxItem>
									))
								)}
							</DropdownMenuGroup>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</header>

			<section className="min-h-0 flex-1 overflow-auto px-18 pb-10 max-[1200px]:px-8 max-[720px]:px-4">
				{/* The slot is always reserved so the table does not jump when the
				    first row is ticked. */}
				<div className="mb-3 flex min-h-9 min-w-240 items-center">
					{selectedThreads.length > 0 ? (
						<div className="flex w-full items-center gap-3 rounded-lg border bg-muted/40 px-4 py-1.5 text-sm">
							<span className="font-medium" aria-live="polite">
								{selectedThreads.length} selected
							</span>
							<div className="ml-auto flex items-center gap-2">
								<Button
									className="h-7 rounded-md px-2.5"
									disabled={isBulkDeleting}
									onClick={() => setBulkCandidates(selectedThreads)}
									size="sm"
									type="button"
									variant="destructive"
								>
									<Trash2 className="size-4" />
									Delete
								</Button>
								<Button
									className="h-7 rounded-md px-2.5"
									disabled={isBulkDeleting}
									onClick={() => {
										setSelectedIds(new Set());
										lastClickedIdRef.current = null;
									}}
									size="sm"
									type="button"
									variant="outline"
								>
									Clear
								</Button>
							</div>
						</div>
					) : null}
				</div>
				<div className="min-w-240 overflow-hidden rounded-lg border bg-card">
					<div className="grid grid-cols-[1.25rem_minmax(14rem,1.35fr)_minmax(9rem,0.8fr)_minmax(12rem,1fr)_7rem_5rem_6rem_1.75rem] gap-x-4 bg-muted/40 px-4 py-3 text-sm font-medium text-muted-foreground">
						<div className="flex items-center">
							<Checkbox
								aria-label="Select all on this page"
								checked={
									allOnPageSelected
										? true
										: selectedThreads.length > 0
											? "indeterminate"
											: false
								}
								className={INDETERMINATE_CHECKBOX_CLASS}
								disabled={visibleThreads.length === 0 || isBulkDeleting}
								onCheckedChange={toggleAllOnPage}
							/>
						</div>
						<span>Title</span>
						<span>Workspace</span>
						<span>Model</span>
						<span>Tokens</span>
						<span>Cost</span>
						<span>Time</span>
						<span className="sr-only">Actions</span>
					</div>
					<div>
						{/* Keep the loader up until the backend's first response: the
						    empty-state copy must only describe an actual zero-session
						    answer, not a fetch that is still in flight or retrying. */}
						{!history.hasLoadedHistory && history.threads.length === 0 ? (
							<div className="flex items-center gap-2 border-t px-4 py-8 text-sm text-muted-foreground">
								<Loader2 className="size-4 animate-spin" />
								Loading session history...
							</div>
						) : null}
						{history.hasLoadedHistory && filteredThreads.length === 0 ? (
							<div className="border-t px-4 py-8 text-sm text-muted-foreground">
								{history.threads.length === 0
									? "No sessions yet."
									: "No sessions match the current filters."}
							</div>
						) : null}
						{visibleThreads.map((thread) => {
							const session = history.sessionById.get(thread.id);
							const isEditing = editingSessionId === thread.id;
							const isPending = history.pendingAction?.sessionId === thread.id;
							const pendingKind = isPending
								? history.pendingAction?.action
								: null;
							const workspace = session?.workspaceRoot || session?.cwd || "";
							const updated = formatRelativeTime(
								session?.lastActivityAt ||
									session?.endedAt ||
									session?.startedAt,
							);
							return (
								<div
									className={cn(
										// Fixed height: every row is the same size so the table
										// never reflows as long values wrap or hydrate in.
										"grid h-14 grid-cols-[1.25rem_minmax(14rem,1.35fr)_minmax(9rem,0.8fr)_minmax(12rem,1fr)_7rem_5rem_6rem_1.75rem] items-center gap-x-4 border-t px-4 text-sm transition-colors",
										activeSessionId === thread.id
											? "bg-surface-hover"
											: "hover:bg-surface-hover-lighter",
									)}
									key={thread.id}
								>
									{/* A sibling of the clickable cells, so ticking never opens the
									    session or interferes with selecting row text. Shift+mousedown
									    is cancelled so range-ticking does not select page text. */}
									<div className="flex select-none items-center">
										<Checkbox
											aria-label={`Select "${thread.title}"`}
											checked={selectedIds.has(thread.id)}
											className={INDETERMINATE_CHECKBOX_CLASS}
											disabled={isBulkDeleting}
											onClick={(event: ReactMouseEvent) =>
												toggleRowSelection(thread.id, event.shiftKey)
											}
											onMouseDown={(event: ReactMouseEvent) => {
												if (event.shiftKey) {
													event.preventDefault();
												}
											}}
										/>
									</div>
									{isEditing ? (
										<form
											className="col-span-6 grid grid-cols-[minmax(14rem,1.35fr)_minmax(9rem,0.8fr)_minmax(12rem,1fr)_7rem_5rem_6rem] items-center gap-x-4"
											onSubmit={(event) => {
												event.preventDefault();
												void submitRename(thread);
											}}
										>
											<div className="col-span-2 flex min-w-0 items-center gap-2">
												<Input
													aria-label={`Rename ${thread.title}`}
													autoFocus
													className="h-8"
													disabled={pendingKind === "rename"}
													onChange={(event) =>
														setEditingTitle(event.target.value)
													}
													onKeyDown={(event) => {
														if (event.key === "Escape") {
															event.preventDefault();
															cancelRename();
														}
													}}
													value={editingTitle}
												/>
												<Button
													aria-label="Save title"
													className="h-8 rounded-md px-2.5"
													disabled={
														pendingKind === "rename" || !editingTitle.trim()
													}
													size="sm"
													type="submit"
												>
													{pendingKind === "rename" ? (
														<Loader2 className="size-4 animate-spin" />
													) : (
														<Check className="size-4" />
													)}
												</Button>
												<Button
													aria-label="Cancel rename"
													className="h-8 rounded-md px-2.5"
													disabled={pendingKind === "rename"}
													onClick={cancelRename}
													size="sm"
													type="button"
													variant="outline"
												>
													<X className="size-4" />
												</Button>
											</div>
											<span
												className="truncate text-muted-foreground"
												title={modelLabel(thread)}
											>
												{modelLabel(thread)}
											</span>
											<span className="text-muted-foreground">
												{tokensLabel(thread)}
											</span>
											<span className="text-muted-foreground">
												{formatCostUsd(thread.totalCostUsd) ?? "-"}
											</span>
											<span className="text-muted-foreground">
												{updated || thread.time}
											</span>
										</form>
									) : (
										// A native <button> suppresses drag-to-select, so the row is a
										// plain container with button semantics: the cells stay
										// selectable and a click that ends a selection does not open
										// the session.
										// biome-ignore lint/a11y/useSemanticElements: buttons are not text-selectable
										<div
											aria-disabled={Boolean(pendingKind)}
											className={cn(
												"col-span-6 grid select-text grid-cols-[minmax(14rem,1.35fr)_minmax(9rem,0.8fr)_minmax(12rem,1fr)_7rem_5rem_6rem] items-center gap-x-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
												pendingKind ? "cursor-default" : "cursor-pointer",
											)}
											onClick={() => openRow(thread)}
											onKeyDown={(event) => {
												if (event.key !== "Enter" && event.key !== " ") {
													return;
												}
												event.preventDefault();
												openRow(thread);
											}}
											role="button"
											tabIndex={pendingKind ? -1 : 0}
										>
											<span className="flex min-w-0 items-center gap-3 font-semibold">
												<span className="sr-only">Open session: </span>
												<SessionStatus
													className="shrink-0"
													label={`Session status: ${thread.status}`}
													showLabel={false}
													style={
														{
															"--cline-ui-session-status-color":
																sessionStatusColor(thread.status),
														} as CSSProperties
													}
													tone={sessionStatusTone(thread.status)}
												/>
												<span className="truncate">{thread.title}</span>
												{thread.origin === "cloud" ? (
													<Cloud
														aria-label="Cloud session"
														className="size-3.5 shrink-0 text-muted-foreground"
													/>
												) : null}
												{thread.pinned ? (
													<Pin
														aria-label="Pinned"
														className="size-3.5 shrink-0 fill-current text-muted-foreground"
													/>
												) : null}
											</span>
											<span className="flex min-w-0 items-center gap-2 text-muted-foreground">
												{thread.origin === "cloud" ? (
													<Cloud className="size-3.5 shrink-0" />
												) : (
													<Folder className="size-3.5 shrink-0" />
												)}
												<span
													className="truncate"
													title={thread.repoUrl || workspace}
												>
													{thread.origin === "cloud"
														? thread.repoUrl || "Cloud repository"
														: workspace
															? basenamePath(workspace)
															: "No workspace"}
												</span>
											</span>
											<span
												className="truncate text-muted-foreground"
												title={modelLabel(thread)}
											>
												{modelLabel(thread)}
											</span>
											<span className="truncate text-muted-foreground">
												{tokensLabel(thread)}
											</span>
											<span className="truncate text-muted-foreground">
												{formatCostUsd(thread.totalCostUsd) ?? "-"}
											</span>
											<span className="truncate text-muted-foreground">
												{updated || thread.time}
											</span>
										</div>
									)}
									<div>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<button
													aria-label={`Session actions for ${thread.title}`}
													className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
													disabled={Boolean(pendingKind)}
													type="button"
												>
													{pendingKind ? (
														<Loader2 className="size-4 animate-spin" />
													) : (
														<MoreHorizontal className="size-4" />
													)}
												</button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end" sideOffset={6}>
												{thread.origin !== "cloud" ? (
													<DropdownMenuItem
														onClick={() =>
															void history.setThreadPinned(
																thread.id,
																!thread.pinned,
															)
														}
													>
														<Pin
															className={cn(
																"size-4",
																thread.pinned && "fill-current",
															)}
														/>
														{thread.pinned ? "Unpin" : "Pin"}
													</DropdownMenuItem>
												) : null}
												<DropdownMenuItem onClick={() => startRename(thread)}>
													<Pencil className="size-4" />
													Rename
												</DropdownMenuItem>
												{thread.origin !== "cloud" ? (
													<DropdownMenuItem
														onClick={() => void history.forkThread(thread.id)}
													>
														<GitFork className="size-4" />
														Fork
													</DropdownMenuItem>
												) : null}
												<DropdownMenuSeparator />
												<DropdownMenuItem
													onClick={() => setDeleteCandidate(thread)}
													variant="destructive"
												>
													<Trash2 className="size-4" />
													Delete
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
								</div>
							);
						})}
						{filteredThreads.length > 0 ? (
							<div className="flex items-center justify-between gap-4 border-t px-4 py-3 text-xs text-muted-foreground">
								<span>
									{`${pageStart + 1}-${pageStart + visibleThreads.length} of ${filteredThreads.length}`}
									{history.mayHaveMoreSessions ? "+" : ""}
								</span>
								<div className="flex items-center gap-1">
									<Button
										aria-label="First page"
										className="h-8 rounded-md px-2.5"
										disabled={currentPage === 0 || history.isLoadingMore}
										onClick={() => changePage(0)}
										size="sm"
										title="First page"
										type="button"
										variant="outline"
									>
										<ChevronsLeft className="size-4" />
									</Button>
									<Button
										aria-label="Previous page"
										className="h-8 rounded-md px-2.5"
										disabled={currentPage === 0 || history.isLoadingMore}
										onClick={() => changePage(currentPage - 1)}
										size="sm"
										title="Previous page"
										type="button"
										variant="outline"
									>
										<ChevronLeft className="size-4" />
									</Button>
									{paginationItems(currentPage + 1, pageCount).map((item) =>
										typeof item === "number" ? (
											<Button
												aria-current={
													item === currentPage + 1 ? "page" : undefined
												}
												aria-label={`Page ${item}`}
												className="h-8 min-w-8 rounded-md px-2 tabular-nums"
												disabled={history.isLoadingMore}
												key={item}
												onClick={() => changePage(item - 1)}
												size="sm"
												type="button"
												variant={item === currentPage + 1 ? "default" : "ghost"}
											>
												{item}
											</Button>
										) : (
											<span
												aria-hidden="true"
												className="px-1 text-muted-foreground"
												key={item}
											>
												...
											</span>
										),
									)}
									<Button
										aria-label="Next page"
										className="h-8 rounded-md px-2.5"
										disabled={!canGoNext || history.isLoadingMore}
										onClick={() => void goToNextPage()}
										size="sm"
										title="Next page"
										type="button"
										variant="outline"
									>
										{history.isLoadingMore ? (
											<Loader2 className="size-4 animate-spin" />
										) : (
											<ChevronRight className="size-4" />
										)}
									</Button>
								</div>
							</div>
						) : null}
					</div>
				</div>
			</section>

			<AlertDialog
				open={deleteCandidate !== null}
				onOpenChange={(open) => {
					if (!open && history.pendingAction?.action !== "delete") {
						setDeleteCandidate(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete session?</AlertDialogTitle>
						<AlertDialogDescription>
							{deleteCandidate?.origin === "cloud"
								? `This deletes "${deleteCandidate?.title ?? "this session"}" and its cloud workspace.`
								: `This removes "${deleteCandidate?.title ?? "this session"}" from local history.`}
							{deleteCandidate?.origin !== "cloud" &&
							isTaskWorktreePath(deleteCandidate?.workspacePath ?? "")
								? ` ${TASK_WORKTREE_DELETE_WARNING}`
								: null}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel
							disabled={history.pendingAction?.action === "delete"}
						>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={
								!deleteCandidate || history.pendingAction?.action === "delete"
							}
							onClick={(event) => {
								event.preventDefault();
								void confirmDelete();
							}}
						>
							{history.pendingAction?.action === "delete" ? (
								<>
									<Loader2 className="size-4 animate-spin" />
									Deleting...
								</>
							) : (
								"Delete"
							)}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog
				open={bulkCandidates !== null}
				onOpenChange={(open) => {
					if (!open && !isBulkDeleting) {
						setBulkCandidates(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{`Delete ${bulkCount} ${bulkCount === 1 ? "session" : "sessions"}?`}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{`This removes ${bulkCount} ${bulkCount === 1 ? "session" : "sessions"} from local history. This can't be undone.`}
							{bulkHasCloud
								? ` Cloud ${bulkCount === 1 ? "session" : "sessions"} also delete${bulkCount === 1 ? "s" : ""} the cloud workspace.`
								: null}
							{bulkHasWorktree
								? ` ${bulkCount === 1 ? TASK_WORKTREE_DELETE_WARNING : BULK_TASK_WORKTREE_DELETE_WARNING}`
								: null}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isBulkDeleting}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={isBulkDeleting}
							onClick={(event) => {
								event.preventDefault();
								void confirmBulkDelete();
							}}
						>
							{bulkProgress ? (
								<>
									<Loader2 className="size-4 animate-spin" />
									{`Deleting ${bulkProgress.current} of ${bulkProgress.total}…`}
								</>
							) : (
								"Delete"
							)}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<ImportSessionsDialog
				onImported={() => void history.refreshSessions()}
				onOpenChange={setImportDialogOpen}
				open={importDialogOpen}
			/>
		</div>
	);
}
