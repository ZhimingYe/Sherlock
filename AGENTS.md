# Sherlock

Flat directory browser for VS Code. Not a tree — one folder at a time, anywhere on disk.

## Project map

```
src/
├── extension.ts       Extension host: provider, messages, watcher
├── protocol.ts        Shared types + runtime guards for both sides
└── frontend/
    ├── main.tsx        DOM mount point
    ├── App.tsx         State owner: sort, filter, message bus
    ├── FileTable.tsx   Rows, columns, context menu, keyboard
    ├── PathBar.tsx     Editable path strip with scroll affordances
    ├── types.ts        Re-exports + UI-only types
    ├── styles.css      Tailwind + VS Code theme bindings
    └── css.d.ts        Import shim for .css
```

Config: `esbuild.ts` (dual-context build), `tailwind.config.ts`, `tsconfig*.json`.

## Commands

| Script | Purpose |
|---|---|
| `npm run build` | esbuild production bundle |
| `npm run watch` | Rebuild on file change |
| `npm run check-types` | `tsc --noEmit` server + client |
| `npm run lint` | oxlint |

## Message protocol

The webview is a dumb renderer — receives complete data structures, echoes back URI strings.
It never parses, joins, or invents paths.

```
UI → Host
  getInitialDirectory
  readDirectory      { requestId, uri }
  readAddress        { requestId, address, baseUri }
  openFile           { uri }
  openFileWith       { uri }
  openDirectoryInTerminal { uri }
  copyPath           { uri, pathKind }
  copyText           { text }

Host → UI
  initialDirectory   { uri }
  directoryContents  { requestId, uri, displayPath, entries, parentUri, pathSegments }
  directoryError     { requestId, uri, error }
  directoryChanged   { uri }
```

Both sides validate messages at runtime through guards in `protocol.ts` — not just compile-time
types. Unknown or malformed payloads are silently dropped.

## Host implementation

### Directory reading

`vscode.workspace.fs.readDirectory()` returns `[name, FileType]` tuples. The host then calls
`stat()` on each entry to populate `size` and `mtime`. Concurrency is capped at 20 via a
worker-pool pattern: a shared index counter feeds closures that grab the next entry until
exhausted.

### Cancellation

A `latestRequestId` counter on the provider is bumped by each incoming `readDirectory` or
`readAddress`. Every async checkpoint — after `readDirectory()`, between `stat()` batches,
before posting the response — checks whether the current `requestId` still matches. If not,
the operation bails. This prevents a fast double-click from flickering the UI with stale data.

### File watcher

A single `FileSystemWatcher` tracks the active directory via `RelativePattern(uri, "*")`.
Create and delete events trigger a reload after a 300ms debounce. Change events are ignored
(size/mtime come from the initial stat, not live). If the filesystem provider doesn't support
watchers, creation fails silently and the user can use the manual refresh button.

### Address resolution

`readAddress` handles free-form path input: `~` expands to home, `~/foo` joins with home,
absolute paths become `vscode.Uri.file()`, relative paths resolve against the current base
URI, and strings with an explicit scheme are parsed as URIs. Empty input throws early.

### Terminal integration

`openDirectoryInTerminal` stats the target URI first: if it's a file, the parent directory
is used instead. The new terminal's name is the basename of the target folder.

## UI implementation

### Virtual scrolling

Rows are fixed at 22px. The scroll container's total height is `items.length * 22px`. On
scroll, a `requestAnimationFrame`-throttled handler computes `visibleStartIndex` and
`visibleEndIndex` from `scrollTop` and `viewportHeight`, plus an 8-row overscan buffer.
Only that slice is rendered via absolute positioning with `top: index * ROW_HEIGHT`.

### Filter pipeline

Three modes, selected by a toggle row below the text input:

- **Text**: case-insensitive substring. Needle is lowercased once, each name checked with
  `.includes()`.
- **Wildcard**: `*` → `.*`, `?` → `.`, everything else escaped for regex, wrapped with `^…$`
  and the `i` flag.
- **Regex**: raw `new RegExp(input, "i")`. Invalid patterns are caught and displayed as an
  inline error string next to the mode toggles; the list stays unfiltered.

All filtering is synchronous client-side. Closing the bar clears the filter value.

### Sorting

`Array.sort()` with a two-pass comparator: directories always sort before files regardless
of the active column. Within each group, the selected column determines order using
`Intl.Collator` for names and numeric comparison for size/mtime. Clicking the active column
header toggles ascending/descending.

### Long paths

The `PathBar` renders each path segment as a `<button>` inside a horizontally scrollable
`<nav>`. A `ResizeObserver` tracks the container width and sets an `overflowing` flag when
`scrollWidth > clientWidth`. When overflowing:

- Fade gradients overlay the left and right edges via `linear-gradient`
- `<` and `>` scroll buttons pan the bar by ~65% of the visible width
- The bar auto-scrolls to the rightmost position on navigation

Double-clicking switches to an `<input>` that accepts direct address entry. Enter commits,
Escape cancels. The input auto-focuses and selects all text.

### Column resizing

8px drag handles between name/size and size/mtime columns. `pointerdown` captures the starting
mouse position and column pixel widths. `pointermove` on `window` computes the delta, clamped
so neither column drops below its minimum. Updates are rAF-batched. `pointerup` tears down
the listeners and restores the cursor.

### Context menu

Right-click sets `contextMenu` state with the entry and a clamped screen position. The menu
measures its own height (item count × 24px + padding) and keeps itself within viewport bounds.
Clicking outside or pressing Escape dismisses it. Menu items vary by entry type: files get an
extra "Open With…" option that directories don't.

### Keyboard navigation

- `ArrowUp` / `ArrowDown` move selection with bounds clamping
- `Enter` opens the selected entry (navigate into directory, open file in editor)
- `Backspace` navigates to the parent directory
- `Escape` dismisses the context menu

Selection triggers auto-scroll: if the selected row is above or below the visible area,
`scrollTop` is adjusted so the row sits within the viewport.

### File icons

A two-level lookup determines the icon for each file:

1. Exact filename match against a map of known names (`.gitignore` → source-control icon,
   `package.json` → package icon, etc.)
2. Extension match against a second map (`.py` → Python icon, `.zip` → archive icon, etc.)
3. Extension falls into a set of known code extensions → generic code icon
4. Extension falls into a set of media extensions → media icon
5. Otherwise → generic file icon

Directories use the folder icon. Symlinks use distinct symlink-directory or symlink-file
variants. Special file types (R scripts, Quarto docs, etc.) get a custom styled badge.

### Theme colors

A `:root` block maps VS Code theme tokens to Tailwind-compatible custom properties:

- Background / foreground from `--vscode-sideBar-*`
- Accent colors from `--vscode-list-*`
- Muted foreground via `color-mix()` blending foreground 55% into background
- Input colors from `--vscode-input-*`
- Border and focus ring from `--vscode-focusBorder`
- Font family from `--vscode-font-family` with system fallbacks

These are re-exported into Tailwind's `@theme inline` block so utility classes like
`bg-background`, `text-muted-foreground`, `border-border` work directly.
