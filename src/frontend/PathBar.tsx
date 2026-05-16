import { clsx } from "clsx";
import { Check, ChevronLeft, ChevronRight, Pencil, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { PathSegment } from "./types";

type PathBarProps = {
	segments: PathSegment[];
	value: string;
	filterActive: boolean;
	onNavigate: (uri: string) => void;
	onNavigateAddress: (address: string) => void;
	onOpenFilter: () => void;
	onRefresh: () => void;
};

export function PathBar({
	segments,
	value,
	filterActive,
	onNavigate,
	onNavigateAddress,
	onOpenFilter,
	onRefresh,
}: PathBarProps) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(value);
	const [overflowing, setOverflowing] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const updateOverflow = () => {
		const el = scrollRef.current;
		if (!el) return;
		setOverflowing(el.scrollWidth > el.clientWidth + 1);
	};

	useEffect(() => {
		if (!editing) {
			setDraft(value);
			scrollRef.current?.scrollTo({ left: scrollRef.current.scrollWidth });
			requestAnimationFrame(updateOverflow);
		}
	}, [editing, value, segments]);

	useEffect(() => {
		if (editing) return;
		const el = scrollRef.current;
		if (!el) return;
		const resizeObserver = new ResizeObserver(updateOverflow);
		resizeObserver.observe(el);
		updateOverflow();
		return () => resizeObserver.disconnect();
	}, [editing]);

	useEffect(() => {
		if (!editing) return;
		inputRef.current?.focus();
		inputRef.current?.select();
	}, [editing]);

	if (segments.length === 0) return null;

	const submit = () => {
		const next = draft.trim();
		if (!next) return;
		setEditing(false);
		onNavigateAddress(next);
	};

	const scrollPath = (direction: "left" | "right") => {
		const el = scrollRef.current;
		if (!el) return;
		const amount = Math.max(80, Math.floor(el.clientWidth * 0.65));
		el.scrollBy({ left: direction === "left" ? -amount : amount, behavior: "smooth" });
	};

	if (editing) {
		return (
			<div className="flex items-center gap-1 border-b border-border px-2 py-1 text-[0.9em]">
				<input
					ref={inputRef}
					className="min-w-0 flex-1 rounded-sm border border-input-border bg-input px-1 py-0.5 font-[family-name:inherit] text-[length:inherit] text-input-foreground outline-none focus:border-focus-border"
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							submit();
						} else if (e.key === "Escape") {
							e.preventDefault();
							setEditing(false);
							setDraft(value);
						}
					}}
				/>
				<button
					className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent text-icon-foreground hover:bg-accent"
					onClick={submit}
					title="Go"
				>
					<Check className="size-3" />
				</button>
				<button
					className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent text-icon-foreground hover:bg-accent"
					onClick={() => {
						setEditing(false);
						setDraft(value);
					}}
					title="Cancel"
				>
					<X className="size-3" />
				</button>
			</div>
		);
	}

	return (
		<div className="flex items-center border-b border-border text-[0.9em]">
			<div className="relative min-w-0 flex-1">
				<nav
					ref={scrollRef}
					className={clsx(
						"scrollbar-none flex min-w-0 items-center gap-0.5 overflow-x-auto px-2 py-1",
						overflowing && "px-7",
					)}
					title={overflowing ? `${value}\nScroll horizontally to see the full path` : value}
					onDoubleClick={() => setEditing(true)}
				>
					{segments.map((segment, i) => (
						<span key={segment.uri} className="flex shrink-0 items-center">
							{i > 0 && <ChevronRight className="mx-0.5 size-3 text-muted-foreground" />}
							<button
								className="max-w-40 cursor-pointer truncate rounded-sm border-none bg-transparent px-1 py-0.5 font-[family-name:inherit] text-[length:inherit] text-foreground hover:bg-accent"
								onClick={() => onNavigate(segment.uri)}
							>
								{segment.label}
							</button>
						</span>
					))}
				</nav>
				{overflowing && (
					<>
						<div className="sherlock-scroll-fade-left" />
						<div className="sherlock-scroll-fade-right" />
						<button
							className="sherlock-path-scroll-button left-0"
							onClick={() => scrollPath("left")}
							title="Scroll path left"
						>
							<ChevronLeft className="size-3" />
						</button>
						<button
							className="sherlock-path-scroll-button right-0"
							onClick={() => scrollPath("right")}
							title="Scroll path right"
						>
							<ChevronRight className="size-3" />
						</button>
					</>
				)}
			</div>
			<button
				className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent text-icon-foreground hover:bg-accent"
				onClick={onRefresh}
				title="Refresh"
			>
				<RefreshCw className="size-3" />
			</button>
			<button
				className={clsx(
					"flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent text-icon-foreground hover:bg-accent",
					filterActive && "bg-accent text-accent-foreground",
				)}
				onClick={onOpenFilter}
				title="Filter Files"
			>
				<Search className="size-3" />
			</button>
			<button
				className="mr-1 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent text-icon-foreground hover:bg-accent"
				onClick={() => setEditing(true)}
				title="Edit Path"
			>
				<Pencil className="size-3" />
			</button>
		</div>
	);
}
