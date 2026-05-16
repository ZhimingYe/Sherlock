import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Search, X } from "lucide-react";

import { isExtensionToWebviewMessage } from "../protocol";
import { PathBar } from "./PathBar";
import { FileTable } from "./FileTable";
import type { PathSegment, DirectoryEntry, SortColumn, SortDirection } from "./types";

type FilterMode = "contains" | "wildcard" | "regex";

const filterModes: { value: FilterMode; label: string; title: string }[] = [
	{ value: "contains", label: "Text", title: "Case-insensitive text match" },
	{ value: "wildcard", label: "* ?", title: "Wildcard match: * matches any text, ? matches one character" },
	{ value: "regex", label: ".*", title: "Regular expression match" },
];
const nameCollator = new Intl.Collator(undefined, { sensitivity: "base" });

declare function acquireVsCodeApi(): {
	postMessage(msg: unknown): void;
	getState(): unknown;
	setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

function compareEntries(
	a: DirectoryEntry,
	b: DirectoryEntry,
	column: SortColumn,
	direction: SortDirection,
): number {
	const dir = direction === "asc" ? 1 : -1;
	switch (column) {
		case "name":
			return dir * nameCollator.compare(a.name, b.name);
		case "size": {
			const aVal = a.size ?? -1;
			const bVal = b.size ?? -1;
			return dir * (aVal - bVal);
		}
		case "mtime": {
			const aVal = a.mtime ?? -1;
			const bVal = b.mtime ?? -1;
			return dir * (aVal - bVal);
		}
	}
}

function sortEntries(
	entries: DirectoryEntry[],
	column: SortColumn,
	direction: SortDirection,
): DirectoryEntry[] {
	return [...entries].sort((a, b) => {
		if (a.kind === "directory" && b.kind !== "directory") return -1;
		if (a.kind !== "directory" && b.kind === "directory") return 1;
		return compareEntries(a, b, column, direction);
	});
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wildcardToRegExp(pattern: string): RegExp {
	const source = [...pattern]
		.map((char) => {
			if (char === "*") return ".*";
			if (char === "?") return ".";
			return escapeRegExp(char);
		})
		.join("");
	return new RegExp(`^${source}$`, "i");
}

function createFilterMatcher(filter: string, mode: FilterMode): {
	error: string | null;
	matches: (name: string) => boolean;
} {
	if (!filter) {
		return { error: null, matches: () => true };
	}
	if (mode === "contains") {
		const needle = filter.toLowerCase();
		return { error: null, matches: (name) => name.toLowerCase().includes(needle) };
	}
	try {
		const pattern = mode === "wildcard" ? wildcardToRegExp(filter) : new RegExp(filter, "i");
		return { error: null, matches: (name) => pattern.test(name) };
	} catch (e: unknown) {
		return {
			error: e instanceof Error ? e.message : "Invalid pattern",
			matches: () => true,
		};
	}
}

export function App() {
	const [currentUri, setCurrentUri] = useState<string>("");
	const [currentPath, setCurrentPath] = useState<string>("");
	const [entries, setEntries] = useState<DirectoryEntry[]>([]);
	const [parentUri, setParentUri] = useState<string | null>(null);
	const [pathSegments, setPathSegments] = useState<PathSegment[]>([]);
	const [filter, setFilter] = useState("");
	const [filterOpen, setFilterOpen] = useState(false);
	const [filterMode, setFilterMode] = useState<FilterMode>("contains");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [sortColumn, setSortColumn] = useState<SortColumn>("name");
	const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
	const requestIdRef = useRef(0);
	const currentUriRef = useRef(currentUri);
	const filterInputRef = useRef<HTMLInputElement>(null);
	currentUriRef.current = currentUri;

	const readDirectory = useCallback((uri: string) => {
		const id = ++requestIdRef.current;
		setLoading(true);
		setError(null);
		vscode.postMessage({ type: "readDirectory", requestId: id, uri });
	}, []);

	const navigate = useCallback(
		(uri: string) => {
			setFilter("");
			setFilterOpen(false);
			readDirectory(uri);
		},
		[readDirectory],
	);

	const navigateAddress = useCallback(
		(address: string) => {
			const id = ++requestIdRef.current;
			setFilter("");
			setFilterOpen(false);
			setLoading(true);
			setError(null);
			vscode.postMessage({ type: "readAddress", requestId: id, address, baseUri: currentUriRef.current });
		},
		[],
	);

	const openFile = useCallback((uri: string) => {
		vscode.postMessage({ type: "openFile", uri });
	}, []);

	const openFileWith = useCallback((uri: string) => {
		vscode.postMessage({ type: "openFileWith", uri });
	}, []);

	const copyPath = useCallback((uri: string, pathKind: "absolute" | "relative") => {
		vscode.postMessage({ type: "copyPath", uri, pathKind });
	}, []);

	const copyText = useCallback((text: string) => {
		vscode.postMessage({ type: "copyText", text });
	}, []);

	const openDirectoryInTerminal = useCallback((uri: string) => {
		vscode.postMessage({ type: "openDirectoryInTerminal", uri });
	}, []);

	const refresh = useCallback(() => {
		if (currentUri) {
			readDirectory(currentUri);
		}
	}, [currentUri, readDirectory]);

	const handleSort = useCallback((column: SortColumn) => {
		setSortColumn((prev) => {
			if (prev === column) {
				setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
			} else {
				setSortDirection(column === "name" ? "asc" : "desc");
			}
			return column;
		});
	}, []);

	useEffect(() => {
		if (!filterOpen) return;
		filterInputRef.current?.focus();
		filterInputRef.current?.select();
	}, [filterOpen]);

	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const msg = event.data;
			if (!isExtensionToWebviewMessage(msg)) return;
			switch (msg.type) {
				case "initialDirectory":
					navigate(msg.uri);
					break;
				case "directoryContents":
					if (msg.requestId !== requestIdRef.current) return;
					setCurrentUri(msg.uri);
					setCurrentPath(msg.displayPath ?? msg.uri);
					setEntries(msg.entries);
					setParentUri(msg.parentUri);
					setPathSegments(msg.pathSegments);
					setError(null);
					setLoading(false);
					break;
				case "directoryError":
					if (msg.requestId !== requestIdRef.current) return;
					setError(msg.error);
					setLoading(false);
					break;
				case "directoryChanged":
					if (msg.uri === currentUriRef.current) {
						readDirectory(currentUriRef.current);
					}
					break;
			}
		};

		window.addEventListener("message", handler);
		vscode.postMessage({ type: "getInitialDirectory" });

		return () => window.removeEventListener("message", handler);
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	const filterMatcher = useMemo(() => createFilterMatcher(filter, filterMode), [filter, filterMode]);

	const sortedFilteredEntries = useMemo(() => {
		const filtered =
			filter && !filterMatcher.error ? entries.filter((e) => filterMatcher.matches(e.name)) : entries;
		return sortEntries(filtered, sortColumn, sortDirection);
	}, [entries, filter, filterMatcher, sortColumn, sortDirection]);

	const filterError = filterMatcher.error;

	return (
		<div className="flex h-screen flex-col py-1">
			<PathBar
				segments={pathSegments}
				value={currentPath || currentUri}
				filterActive={filterOpen || filter.length > 0}
				onNavigate={navigate}
				onNavigateAddress={navigateAddress}
				onOpenFilter={() => setFilterOpen(true)}
				onRefresh={refresh}
			/>
			{filterOpen && (
				<div className="border-b border-border px-2 py-1">
					<div className="relative">
						<Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
						<input
							ref={filterInputRef}
							className={`w-full rounded-sm border bg-input py-1 pr-7 pl-7 font-[family-name:inherit] text-[length:inherit] text-input-foreground outline-none ${
								filterError
									? "border-error-foreground focus:border-error-foreground"
									: "border-input-border focus:border-focus-border"
							}`}
							type="text"
							placeholder={
								filterMode === "wildcard"
									? "Filter with wildcards..."
									: filterMode === "regex"
										? "Filter with regex..."
										: "Filter..."
							}
							value={filter}
							onChange={(e) => setFilter(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Escape") {
									e.preventDefault();
									setFilter("");
									setFilterOpen(false);
								}
							}}
						/>
						<button
							className="absolute top-1/2 right-1 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent text-icon-foreground hover:bg-accent"
							onClick={() => {
								setFilter("");
								setFilterOpen(false);
							}}
							title="Close Filter"
						>
							<X className="size-3" />
						</button>
					</div>
					<div className="mt-1 flex min-w-0 items-center gap-1">
						<div className="flex shrink-0 overflow-hidden rounded-sm border border-input-border">
							{filterModes.map((mode) => (
								<button
									key={mode.value}
									className={`h-6 cursor-pointer border-0 border-r border-input-border px-2 font-[family-name:inherit] text-[0.85em] last:border-r-0 ${
										filterMode === mode.value
											? "bg-accent text-accent-foreground"
											: "bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground"
									}`}
									onClick={() => setFilterMode(mode.value)}
									title={mode.title}
								>
									{mode.label}
								</button>
							))}
						</div>
						{filterError && (
							<div
								className="min-w-0 truncate text-[0.85em] text-error-foreground"
								title={filterError}
							>
								{filterError}
							</div>
						)}
					</div>
				</div>
			)}
			{error && <div className="px-2 py-1 text-[0.9em] text-error-foreground">{error}</div>}
			<FileTable
				entries={sortedFilteredEntries}
				parentUri={parentUri}
				loading={loading}
				sortColumn={sortColumn}
				sortDirection={sortDirection}
				onSort={handleSort}
				onNavigate={navigate}
				onOpenFile={openFile}
				onOpenFileWith={openFileWith}
				onCopyPath={copyPath}
				onCopyText={copyText}
				onOpenDirectoryInTerminal={openDirectoryInTerminal}
			/>
		</div>
	);
}
