import { clsx } from "clsx";
import { CornerUpLeft, ArrowUp, ArrowDown, Loader } from "lucide-react";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";

import type { DirectoryEntry, SortColumn, SortDirection } from "./types";

type FileTableProps = {
	entries: DirectoryEntry[];
	parentUri: string | null;
	loading: boolean;
	currentPath: string;
	sortColumn: SortColumn;
	sortDirection: SortDirection;
	onSort: (column: SortColumn) => void;
	onNavigate: (uri: string) => void;
	onOpenFile: (uri: string) => void;
	onOpenFileWith: (uri: string) => void;
	onCopyPath: (uri: string, pathKind: "absolute" | "relative") => void;
	onCopyText: (text: string) => void;
	onOpenDirectoryInTerminal: (uri: string) => void;
};

type ListItem = { type: "parent"; uri: string } | { type: "entry"; entry: DirectoryEntry };
type ContextMenuState = {
	x: number;
	y: number;
	entry: DirectoryEntry;
};
type ColumnId = "name" | "size" | "mtime";
type ColumnWidths = Record<ColumnId, number>;

const INITIAL_COLUMN_WIDTHS: ColumnWidths = {
	name: 6,
	size: 2,
	mtime: 3,
};

const MIN_COLUMN_WIDTHS: ColumnWidths = {
	name: 32,
	size: 24,
	mtime: 32,
};

const RESIZE_HANDLE_WIDTH = 8;
const ROW_HEIGHT = 22;
const HEADER_HEIGHT = 23;
const VIRTUAL_OVERSCAN = 8;
const CONTEXT_MENU_WIDTH = 176;
const CONTEXT_MENU_VERTICAL_PADDING = 8;
const CONTEXT_MENU_ITEM_HEIGHT = 24;
const CONTEXT_MENU_MARGIN = 4;

const FILE_NAME_ICON_CLASSES = new Map<string, string>([
	[".dockerignore", "codicon-package"],
	[".env", "codicon-settings"],
	[".env.example", "codicon-settings"],
	[".flake8", "codicon-python"],
	[".gitattributes", "codicon-source-control"],
	[".gitignore", "codicon-source-control"],
	[".gitmodules", "codicon-source-control"],
	[".lintr", "sherlock-icon-r"],
	[".python-version", "codicon-python"],
	[".rbuildignore", "sherlock-icon-r"],
	[".renviron", "sherlock-icon-r"],
	[".rhistory", "sherlock-icon-r"],
	[".rprofile", "sherlock-icon-r"],
	[".ruff.toml", "codicon-python"],
	["dockerfile", "codicon-package"],
	["description", "sherlock-icon-r"],
	["license", "codicon-book"],
	["makefile", "codicon-gear"],
	["manifest.in", "codicon-python"],
	["namespace", "sherlock-icon-r"],
	["package-lock.json", "codicon-package"],
	["package.json", "codicon-package"],
	["pipfile", "codicon-python"],
	["pipfile.lock", "codicon-python"],
	["pnpm-lock.yaml", "codicon-package"],
	["poetry.lock", "codicon-python"],
	["pyproject.toml", "codicon-python"],
	["readme", "codicon-markdown"],
	["readme.md", "codicon-markdown"],
	["renv.lock", "sherlock-icon-r"],
	["requirements-dev.txt", "codicon-python"],
	["requirements.txt", "codicon-python"],
	["setup.cfg", "codicon-python"],
	["setup.py", "codicon-python"],
	["tsconfig.json", "codicon-json"],
	["tox.ini", "codicon-python"],
	["uv.lock", "codicon-python"],
	["yarn.lock", "codicon-package"],
]);

const FILE_EXTENSION_ICON_CLASSES = new Map<string, string>([
	["arrow", "codicon-database"],
	["arff", "codicon-database"],
	["avro", "codicon-database"],
	["bz2", "codicon-file-zip"],
	["csv", "codicon-table"],
	["dat", "codicon-database"],
	["db", "codicon-database"],
	["dta", "codicon-database"],
	["feather", "codicon-database"],
	["gz", "codicon-file-zip"],
	["h5", "codicon-database"],
	["h5ad", "codicon-database"],
	["hdf5", "codicon-database"],
	["ipc", "codicon-database"],
	["ipynb", "codicon-notebook"],
	["joblib", "codicon-database"],
	["json", "codicon-json"],
	["jsonc", "codicon-json"],
	["jsonl", "codicon-json"],
	["lock", "codicon-package"],
	["map", "codicon-json"],
	["markdown", "codicon-markdown"],
	["mat", "codicon-database"],
	["md", "codicon-markdown"],
	["mdx", "codicon-markdown"],
	["ndjson", "codicon-json"],
	["ods", "codicon-table"],
	["orc", "codicon-database"],
	["parquet", "codicon-database"],
	["pdf", "codicon-file-pdf"],
	["pickle", "codicon-database"],
	["pkl", "codicon-database"],
	["pq", "codicon-database"],
	["py", "codicon-python"],
	["pyc", "codicon-python"],
	["pyd", "codicon-python"],
	["pyi", "codicon-python"],
	["pyo", "codicon-python"],
	["pyw", "codicon-python"],
	["pyx", "codicon-python"],
	["qmd", "sherlock-icon-r"],
	["qs", "codicon-database"],
	["qs2", "codicon-database"],
	["r", "sherlock-icon-r"],
	["rar", "codicon-file-zip"],
	["rda", "sherlock-icon-r"],
	["rdata", "sherlock-icon-r"],
	["rds", "sherlock-icon-r"],
	["rhistory", "sherlock-icon-r"],
	["rmd", "sherlock-icon-r"],
	["rnw", "sherlock-icon-r"],
	["rproj", "sherlock-icon-r"],
	["rprofile", "sherlock-icon-r"],
	["rsx", "sherlock-icon-r"],
	["sas7bdat", "codicon-database"],
	["sav", "codicon-database"],
	["sqlite", "codicon-database"],
	["sqlite3", "codicon-database"],
	["tar", "codicon-file-zip"],
	["tgz", "codicon-file-zip"],
	["tsv", "codicon-table"],
	["txt", "codicon-file-text"],
	["webp", "codicon-file-media"],
	["xls", "codicon-table"],
	["xlsx", "codicon-table"],
	["xz", "codicon-file-zip"],
	["yaml", "codicon-settings"],
	["yml", "codicon-settings"],
	["zip", "codicon-file-zip"],
]);

	const DATA_EXTENSIONS = new Set([
		"arff",
		"arrow",
		"avro",
		"csv",
		"dat",
		"dta",
		"feather",
		"h5",
		"h5ad",
		"hdf5",
		"ipc",
		"joblib",
		"jsonl",
		"mat",
		"ndjson",
		"ods",
		"orc",
		"parquet",
		"pickle",
		"pkl",
		"pq",
		"qs",
		"qs2",
		"sas7bdat",
		"sav",
		"tsv",
		"txt",
		"xls",
		"xlsx",
	]);

const CODE_EXTENSIONS = new Set([
	"astro",
	"bat",
	"c",
	"cmd",
	"conf",
	"cpp",
	"cs",
	"css",
	"cts",
	"cxx",
	"fish",
	"go",
	"h",
	"hpp",
	"html",
	"java",
	"js",
	"jsx",
	"kts",
	"kt",
	"less",
	"lua",
	"mjs",
	"mts",
	"php",
	"ps1",
	"rb",
	"rs",
	"sass",
	"scala",
	"scss",
	"sh",
	"sql",
	"svelte",
	"swift",
	"toml",
	"ts",
	"tsx",
	"vue",
	"xml",
	"zsh",
]);

const MEDIA_EXTENSIONS = new Set([
	"avi",
	"bmp",
	"gif",
	"ico",
	"jpeg",
	"jpg",
	"m4a",
	"mkv",
	"mov",
	"mp3",
	"mp4",
	"ogg",
	"png",
	"svg",
	"tif",
	"tiff",
	"wav",
	"webm",
]);

function getFileExtension(name: string): string {
	const lowerName = name.toLowerCase();
	if (lowerName.endsWith(".tar.gz")) return "tgz";
	const lastDot = lowerName.lastIndexOf(".");
	if (lastDot <= 0 || lastDot === lowerName.length - 1) return "";
	return lowerName.slice(lastDot + 1);
}

function formatSize(bytes: number | null): string {
	if (bytes === null) return "";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(mtime: number | null, now: Date): string {
	if (mtime === null) return "";
	const date = new Date(mtime);
	const msPerDay = 86400000;
	const diffDays = Math.floor((now.getTime() - date.getTime()) / msPerDay);
	const timeStr = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
	const sameYear = date.getFullYear() === now.getFullYear();

	if (diffDays < 1) {
		return timeStr;
	}
	if (diffDays < 7) {
		const dateStr = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
		return `${dateStr} ${timeStr}`;
	}
	if (sameYear) {
		return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
	}
	return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function SortIndicator({
	column,
	sortColumn,
	sortDirection,
}: {
	column: SortColumn;
	sortColumn: SortColumn;
	sortDirection: SortDirection;
}) {
	if (column !== sortColumn) return null;
	return sortDirection === "asc" ? (
		<ArrowUp className="size-3 shrink-0" />
	) : (
		<ArrowDown className="size-3 shrink-0" />
	);
}

function FileIcon({ entry }: { entry: DirectoryEntry }) {
	const isDir = entry.kind === "directory";
	const iconClass = entry.isSymbolicLink
		? isDir
			? "codicon-file-symlink-directory"
			: "codicon-file-symlink-file"
			: isDir
				? "codicon-folder"
				: getFileIconClass(entry.name);

	if (iconClass === "sherlock-icon-r") {
		return (
			<span
				aria-hidden="true"
				className={clsx(
					"shrink-0 sherlock-icon sherlock-icon-file",
					"sherlock-icon-r",
				)}
			>
				R
			</span>
		);
	}

	return (
		<span
			aria-hidden="true"
			className={clsx(
				"codicon shrink-0 sherlock-icon",
				isDir ? "sherlock-icon-folder" : "sherlock-icon-file",
				iconClass,
			)}
		/>
	);
}

function getFileIconClass(name: string): string {
	const lowerName = name.toLowerCase();
	const fileNameIcon = FILE_NAME_ICON_CLASSES.get(lowerName);
	if (fileNameIcon) return fileNameIcon;

	const extension = getFileExtension(name);
	const extensionIcon = FILE_EXTENSION_ICON_CLASSES.get(extension);
	if (extensionIcon) return extensionIcon;
	if (DATA_EXTENSIONS.has(extension)) return "codicon-database";
	if (CODE_EXTENSIONS.has(extension)) return "codicon-file-code";
	if (MEDIA_EXTENSIONS.has(extension)) return "codicon-file-media";
	return "codicon-file";
}

function clampMenuPosition(
	x: number,
	y: number,
	entry: DirectoryEntry,
): { x: number; y: number } {
	const itemCount = entry.kind === "directory" ? 5 : 6;
	const menuHeight = itemCount * CONTEXT_MENU_ITEM_HEIGHT + CONTEXT_MENU_VERTICAL_PADDING;
	const maxX = Math.max(CONTEXT_MENU_MARGIN, window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_MARGIN);
	const maxY = Math.max(CONTEXT_MENU_MARGIN, window.innerHeight - menuHeight - CONTEXT_MENU_MARGIN);

	return {
		x: Math.max(CONTEXT_MENU_MARGIN, Math.min(x, maxX)),
		y: Math.max(CONTEXT_MENU_MARGIN, Math.min(y, maxY)),
	};
}

export function FileTable({
	entries,
	parentUri,
	loading,
	sortColumn,
	sortDirection,
	onSort,
	onNavigate,
	onOpenFile,
	onOpenFileWith,
	onCopyPath,
	onCopyText,
	onOpenDirectoryInTerminal,
	currentPath,
}: FileTableProps) {
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [slowHint, setSlowHint] = useState(false);
	const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
	const [columnWidths, setColumnWidths] = useState<ColumnWidths>(INITIAL_COLUMN_WIDTHS);
	const [scrollTop, setScrollTop] = useState(0);
	const [viewportHeight, setViewportHeight] = useState(0);
	const listRef = useRef<HTMLDivElement>(null);
	const pendingScrollTopRef = useRef(0);
	const scrollFrameRef = useRef<number | null>(null);
	const pendingColumnWidthsRef = useRef<ColumnWidths | null>(null);
	const resizeFrameRef = useRef<number | null>(null);
	const headerCellRefs = useRef<Partial<Record<ColumnId, HTMLDivElement | null>>>({});
	const resizeRef = useRef<{
		column: ColumnId;
		nextColumn: ColumnId;
		startX: number;
		startWidths: ColumnWidths;
	} | null>(null);

	const items = useMemo<ListItem[]>(() => {
		const nextItems: ListItem[] = [];
		if (parentUri) {
			nextItems.push({ type: "parent", uri: parentUri });
		}
		for (const entry of entries) {
			nextItems.push({ type: "entry", entry });
		}
		return nextItems;
	}, [entries, parentUri]);

	useEffect(() => {
		setSelectedIndex(0);
		setScrollTop(0);
		if (listRef.current) {
			listRef.current.scrollTop = 0;
		}
	}, [entries, parentUri]);

	useEffect(() => {
		const listElement = listRef.current;
		if (!listElement) return;

		const updateViewportHeight = () => {
			setViewportHeight(listElement.clientHeight);
		};

		updateViewportHeight();
		if (typeof ResizeObserver === "undefined") {
			window.addEventListener("resize", updateViewportHeight);
			return () => window.removeEventListener("resize", updateViewportHeight);
		}
		const resizeObserver = new ResizeObserver(updateViewportHeight);
		resizeObserver.observe(listElement);
		return () => resizeObserver.disconnect();
	}, [loading]);

	useEffect(() => {
		if (!loading) {
			setSlowHint(false);
			return;
		}
		const timer = setTimeout(() => setSlowHint(true), 3000);
		return () => clearTimeout(timer);
	}, [loading]);

	useEffect(() => {
		return () => {
			if (scrollFrameRef.current !== null) {
				cancelAnimationFrame(scrollFrameRef.current);
			}
			if (resizeFrameRef.current !== null) {
				cancelAnimationFrame(resizeFrameRef.current);
			}
		};
	}, []);

	const triggerItem = useCallback(
		(item: ListItem) => {
			setContextMenu(null);
			if (item.type === "parent") {
				onNavigate(item.uri);
			} else if (item.entry.kind === "directory") {
				onNavigate(item.entry.uri);
			} else {
				onOpenFile(item.entry.uri);
			}
		},
		[onNavigate, onOpenFile],
	);

	const openEntry = useCallback(
		(entry: DirectoryEntry) => {
			setContextMenu(null);
			if (entry.kind === "directory") {
				onNavigate(entry.uri);
			} else {
				onOpenFile(entry.uri);
			}
		},
		[onNavigate, onOpenFile],
	);

	const openEntryWith = useCallback(
		(entry: DirectoryEntry) => {
			setContextMenu(null);
			onOpenFileWith(entry.uri);
		},
		[onOpenFileWith],
	);

	const copyEntryPath = useCallback(
		(entry: DirectoryEntry, pathKind: "absolute" | "relative") => {
			setContextMenu(null);
			onCopyPath(entry.uri, pathKind);
		},
		[onCopyPath],
	);

	const copyEntryName = useCallback(
		(entry: DirectoryEntry) => {
			setContextMenu(null);
			onCopyText(entry.name);
		},
		[onCopyText],
	);

	const openEntryInTerminal = useCallback(
		(entry: DirectoryEntry) => {
			setContextMenu(null);
			onOpenDirectoryInTerminal(entry.uri);
		},
		[onOpenDirectoryInTerminal],
	);

	const handleRowContextMenu = useCallback(
		(e: React.MouseEvent, entry: DirectoryEntry, index: number) => {
			e.preventDefault();
			const position = clampMenuPosition(e.clientX, e.clientY, entry);
			setSelectedIndex(index);
			setContextMenu({ ...position, entry });
		},
		[],
	);

	const selectRow = useCallback((index: number) => {
		setContextMenu(null);
		setSelectedIndex(index);
	}, []);

	const beginColumnResize = useCallback(
		(e: React.PointerEvent, column: ColumnId, nextColumn: ColumnId) => {
			e.preventDefault();
			e.stopPropagation();
			const startWidths: ColumnWidths = {
				name: headerCellRefs.current.name?.getBoundingClientRect().width ?? columnWidths.name,
				size: headerCellRefs.current.size?.getBoundingClientRect().width ?? columnWidths.size,
				mtime: headerCellRefs.current.mtime?.getBoundingClientRect().width ?? columnWidths.mtime,
			};
			resizeRef.current = {
				column,
				nextColumn,
				startX: e.clientX,
				startWidths,
			};
			setColumnWidths(startWidths);
			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";
		},
		[columnWidths],
	);

	useEffect(() => {
		const handlePointerMove = (e: PointerEvent) => {
			const resize = resizeRef.current;
			if (!resize) return;
			const delta = e.clientX - resize.startX;
			const startWidth = resize.startWidths[resize.column];
			const nextStartWidth = resize.startWidths[resize.nextColumn];
			const columnMinWidth = Math.min(MIN_COLUMN_WIDTHS[resize.column], startWidth);
			const nextMinWidth = Math.min(MIN_COLUMN_WIDTHS[resize.nextColumn], nextStartWidth);
			const maxDelta = nextStartWidth - nextMinWidth;
			const minDelta = columnMinWidth - startWidth;
			const clampedDelta = Math.max(minDelta, Math.min(maxDelta, delta));
			pendingColumnWidthsRef.current = {
				...resize.startWidths,
				[resize.column]: startWidth + clampedDelta,
				[resize.nextColumn]: nextStartWidth - clampedDelta,
			};

			if (resizeFrameRef.current !== null) return;
			resizeFrameRef.current = requestAnimationFrame(() => {
				resizeFrameRef.current = null;
				if (pendingColumnWidthsRef.current) {
					setColumnWidths(pendingColumnWidthsRef.current);
					pendingColumnWidthsRef.current = null;
				}
			});
		};
		const handlePointerUp = () => {
			if (!resizeRef.current) return;
			resizeRef.current = null;
			if (resizeFrameRef.current !== null) {
				cancelAnimationFrame(resizeFrameRef.current);
				resizeFrameRef.current = null;
			}
			if (pendingColumnWidthsRef.current) {
				setColumnWidths(pendingColumnWidthsRef.current);
				pendingColumnWidthsRef.current = null;
			}
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
		};
		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", handlePointerUp);
		return () => {
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", handlePointerUp);
			if (resizeFrameRef.current !== null) {
				cancelAnimationFrame(resizeFrameRef.current);
				resizeFrameRef.current = null;
			}
			pendingColumnWidthsRef.current = null;
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
		};
	}, []);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			switch (e.key) {
				case "ArrowUp":
					e.preventDefault();
					setSelectedIndex((i) => Math.max(0, i - 1));
					break;
				case "ArrowDown":
					e.preventDefault();
					setSelectedIndex((i) => Math.min(Math.max(0, items.length - 1), i + 1));
					break;
				case "Enter": {
					e.preventDefault();
					const item = items[selectedIndex];
					if (item) triggerItem(item);
					break;
				}
				case "Backspace":
					e.preventDefault();
					if (parentUri) onNavigate(parentUri);
					break;
				case "Escape":
					setContextMenu(null);
					break;
			}
		},
		[items, selectedIndex, triggerItem, parentUri, onNavigate],
	);

	useEffect(() => {
		if (!contextMenu) return;
		const close = () => setContextMenu(null);
		window.addEventListener("click", close);
		window.addEventListener("blur", close);
		return () => {
			window.removeEventListener("click", close);
			window.removeEventListener("blur", close);
		};
	}, [contextMenu]);

	useEffect(() => {
		const listElement = listRef.current;
		if (!listElement || selectedIndex < 0 || selectedIndex >= items.length) return;

		const rowTop = HEADER_HEIGHT + selectedIndex * ROW_HEIGHT;
		const rowBottom = rowTop + ROW_HEIGHT;
		const visibleTop = listElement.scrollTop + HEADER_HEIGHT;
		const visibleBottom = listElement.scrollTop + listElement.clientHeight;
		let nextScrollTop = listElement.scrollTop;

		if (rowTop < visibleTop) {
			nextScrollTop = Math.max(0, rowTop - HEADER_HEIGHT);
		} else if (rowBottom > visibleBottom) {
			nextScrollTop = rowBottom - listElement.clientHeight;
		}

		if (nextScrollTop !== listElement.scrollTop) {
			listElement.scrollTop = nextScrollTop;
			setScrollTop(nextScrollTop);
		}
	}, [items.length, selectedIndex]);

	const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
		pendingScrollTopRef.current = e.currentTarget.scrollTop;
		if (scrollFrameRef.current !== null) return;

		scrollFrameRef.current = requestAnimationFrame(() => {
			scrollFrameRef.current = null;
			setScrollTop(pendingScrollTopRef.current);
		});
	}, []);

	const now = new Date();

	if (loading && entries.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center gap-3 p-6 text-muted-foreground">
				<Loader className="size-5 animate-spin" />
				<div className="text-center text-[0.9em]">
					<p>Reading directory…</p>
					<p className="mt-0.5 max-w-[90%] truncate text-[0.85em] opacity-70">
						{currentPath}
					</p>
				</div>
				{slowHint && (
					<p className="text-center text-[0.8em] opacity-60">
						Still working — remote filesystems may take longer.
					</p>
				)}
			</div>
		);
	}

	const columnHeaderClass =
		"flex min-w-0 items-center gap-0.5 cursor-pointer select-none hover:text-foreground";
	const gridTemplateColumns = `minmax(0, ${columnWidths.name}fr) ${RESIZE_HANDLE_WIDTH}px minmax(0, ${columnWidths.size}fr) ${RESIZE_HANDLE_WIDTH}px minmax(0, ${columnWidths.mtime}fr)`;
	const bodyViewportHeight = Math.max(0, viewportHeight - HEADER_HEIGHT);
	const bodyScrollTop = Math.max(0, scrollTop - HEADER_HEIGHT);
	const visibleStartIndex = Math.max(
		0,
		Math.floor(bodyScrollTop / ROW_HEIGHT) - VIRTUAL_OVERSCAN,
	);
	const visibleEndIndex = Math.min(
		items.length,
		Math.ceil((bodyScrollTop + bodyViewportHeight) / ROW_HEIGHT) + VIRTUAL_OVERSCAN,
	);
	const visibleItems = items.slice(visibleStartIndex, visibleEndIndex);

	const renderResizeHandle = (column: ColumnId, nextColumn: ColumnId) => (
		<div
			className="sherlock-resize-handle"
			role="separator"
			aria-orientation="vertical"
			onPointerDown={(e) => beginColumnResize(e, column, nextColumn)}
		/>
	);

	return (
		<div
			className="flex-1 overflow-y-auto overflow-x-hidden outline-none"
			ref={listRef}
			tabIndex={0}
			onKeyDown={handleKeyDown}
			onScroll={handleScroll}
		>
			{/* Column headers + refresh */}
			<div className="sticky top-0 z-10 border-b border-border bg-background">
				<div
					className="grid h-[22px] items-center px-2 text-[0.85em] text-muted-foreground"
					style={{ gridTemplateColumns, width: "100%" }}
				>
					<div
						ref={(el) => {
							headerCellRefs.current.name = el;
						}}
						className="flex min-w-0 items-center gap-1.5"
					>
						<span className="w-4 shrink-0" />
						<button className={columnHeaderClass} onClick={() => onSort("name")}>
							<span className="truncate">Name</span>
							<SortIndicator column="name" sortColumn={sortColumn} sortDirection={sortDirection} />
						</button>
					</div>
					{renderResizeHandle("name", "size")}
					<div
						ref={(el) => {
							headerCellRefs.current.size = el;
						}}
						className="flex min-w-0 justify-end"
					>
						<button className={clsx(columnHeaderClass, "justify-end")} onClick={() => onSort("size")}>
							<span className="truncate">Size</span>
							<SortIndicator column="size" sortColumn={sortColumn} sortDirection={sortDirection} />
						</button>
					</div>
					{renderResizeHandle("size", "mtime")}
					<div
						ref={(el) => {
							headerCellRefs.current.mtime = el;
						}}
						className="flex min-w-0 justify-end"
					>
						<button className={clsx(columnHeaderClass, "justify-end")} onClick={() => onSort("mtime")}>
							<span className="truncate">Modified</span>
							<SortIndicator column="mtime" sortColumn={sortColumn} sortDirection={sortDirection} />
						</button>
					</div>
			</div>
		</div>
			{items.length === 0 ? (
				<div className="p-2 text-center text-muted-foreground">Empty directory</div>
			) : (
				<div
					className="relative"
					style={{ height: items.length * ROW_HEIGHT, width: "100%" }}
				>
					{visibleItems.map((item, visibleIndex) => {
						const index = visibleStartIndex + visibleIndex;
						const selected = index === selectedIndex;
						if (item.type === "parent") {
							return (
								<div
									key=".."
									className={clsx(
										"absolute left-0 right-0 grid items-center px-2 h-[22px] cursor-pointer select-none",
										selected ? "bg-selected text-selected-foreground" : "hover:bg-accent",
									)}
									style={{ gridTemplateColumns, top: index * ROW_HEIGHT }}
									data-index={index}
									onClick={() => selectRow(index)}
									onDoubleClick={() => triggerItem(item)}
								>
									<div className="flex min-w-0 items-center gap-1.5">
										<CornerUpLeft className="size-4 shrink-0" />
										<span className="truncate">..</span>
									</div>
									<span />
									<span />
									<span />
									<span />
								</div>
							);
						}
						const { entry } = item;
						const isDir = entry.kind === "directory";
						return (
							<div
								key={entry.uri}
								className={clsx(
									"absolute left-0 right-0 grid items-center px-2 h-[22px] cursor-pointer select-none",
									selected ? "bg-selected text-selected-foreground" : "hover:bg-accent",
								)}
								style={{ gridTemplateColumns, top: index * ROW_HEIGHT }}
								data-index={index}
								onClick={() => selectRow(index)}
								onDoubleClick={() => triggerItem(item)}
								onContextMenu={(e) => handleRowContextMenu(e, entry, index)}
							>
								<div className="flex min-w-0 items-center gap-1.5 pr-2">
									<FileIcon entry={entry} />
									<span className="truncate text-[0.92em]">{entry.name}</span>
								</div>
								<span />
								<span className="min-w-0 truncate text-right text-[0.85em] text-muted-foreground">
									{isDir ? "" : formatSize(entry.size)}
								</span>
								<span />
								<span className="min-w-0 truncate text-right text-[0.85em] text-muted-foreground">
									{formatDate(entry.mtime, now)}
								</span>
							</div>
						);
					})}
				</div>
			)}
			{contextMenu && (
				<div
					className="fixed z-50 min-w-40 border border-border bg-background py-1 text-foreground shadow-lg"
					style={{ left: contextMenu.x, top: contextMenu.y }}
					onClick={(e) => e.stopPropagation()}
					onContextMenu={(e) => e.preventDefault()}
				>
					<button
						className="block w-full px-3 py-1 text-left hover:bg-accent hover:text-accent-foreground"
						onClick={() => openEntry(contextMenu.entry)}
					>
						Open File
					</button>
					{contextMenu.entry.kind !== "directory" && (
						<button
							className="block w-full px-3 py-1 text-left hover:bg-accent hover:text-accent-foreground"
							onClick={() => openEntryWith(contextMenu.entry)}
						>
							Open With...
						</button>
					)}
					<button
						className="block w-full px-3 py-1 text-left hover:bg-accent hover:text-accent-foreground"
						onClick={() => openEntryInTerminal(contextMenu.entry)}
					>
						Open in Terminal
					</button>
					<button
						className="block w-full px-3 py-1 text-left hover:bg-accent hover:text-accent-foreground"
						onClick={() => copyEntryPath(contextMenu.entry, "absolute")}
					>
						Copy Absolute Path
					</button>
					<button
						className="block w-full px-3 py-1 text-left hover:bg-accent hover:text-accent-foreground"
						onClick={() => copyEntryPath(contextMenu.entry, "relative")}
					>
						Copy Relative Path
					</button>
					<button
						className="block w-full px-3 py-1 text-left hover:bg-accent hover:text-accent-foreground"
						onClick={() => copyEntryName(contextMenu.entry)}
					>
						Copy File Name
					</button>
				</div>
			)}
		</div>
	);
}
