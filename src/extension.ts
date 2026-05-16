import * as os from "os";
import * as path from "path";

import * as vscode from "vscode";

import {
	isWebviewToExtensionMessage,
	type PathSegment,
	type DirectoryEntry,
	type ExtensionToWebviewMessage,
	type WebviewToExtensionMessage,
} from "./protocol";

const STAT_CONCURRENCY = 20;
const WATCHER_DEBOUNCE_MS = 300;
const VIEW_ID = "sherlock.directoryView";
const NONCE_LENGTH = 32;
const NONCE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function parseUri(value: string): vscode.Uri | undefined {
	try {
		return vscode.Uri.parse(value, true);
	} catch {
		return undefined;
	}
}

function postToWebview(webview: vscode.Webview, message: ExtensionToWebviewMessage): void {
	void webview.postMessage(message);
}

function getInitialDirectoryUri(): vscode.Uri {
	return vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(os.homedir());
}

function getParentPath(uri: vscode.Uri): string {
	return path.posix.dirname(uri.path);
}

function getParentUri(uri: vscode.Uri): vscode.Uri | undefined {
	const parentPath = getParentPath(uri);
	return parentPath === uri.path ? undefined : uri.with({ path: parentPath });
}

function getParentUriString(uri: vscode.Uri): string | null {
	return getParentUri(uri)?.toString() ?? null;
}

function getPathSegments(uri: vscode.Uri): PathSegment[] {
	const segments: PathSegment[] = [];
	let currentUri = uri;

	while (true) {
		segments.unshift({
			label: path.posix.basename(currentUri.path) || "/",
			uri: currentUri.toString(),
		});

		const parentUri = getParentUri(currentUri);
		if (!parentUri) {
			return segments;
		}
		currentUri = parentUri;
	}
}

function getDisplayPath(uri: vscode.Uri): string {
	return uri.scheme === "file" ? uri.fsPath : uri.toString();
}

function resolveAddress(address: string, baseUri: vscode.Uri | undefined): vscode.Uri {
	const trimmedAddress = address.trim();
	if (!trimmedAddress) {
		throw new Error("Path is empty");
	}

	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmedAddress)) {
		return vscode.Uri.parse(trimmedAddress, true);
	}

	let expandedPath = trimmedAddress;
	if (expandedPath === "~") {
		expandedPath = os.homedir();
	} else if (expandedPath.startsWith("~/")) {
		expandedPath = path.join(os.homedir(), expandedPath.slice(2));
	}

	if (path.isAbsolute(expandedPath)) {
		return vscode.Uri.file(expandedPath);
	}

	if (!baseUri) {
		return vscode.Uri.file(path.resolve(expandedPath));
	}

	if (baseUri.scheme === "file") {
		return vscode.Uri.file(path.resolve(baseUri.fsPath, expandedPath));
	}

	return vscode.Uri.joinPath(baseUri, expandedPath);
}

function getEntryKind(fileType: vscode.FileType): Pick<DirectoryEntry, "kind" | "isSymbolicLink"> {
	const isSymbolicLink = (fileType & vscode.FileType.SymbolicLink) !== 0;
	const baseType = fileType & ~vscode.FileType.SymbolicLink;

	if (baseType === vscode.FileType.Directory) {
		return { kind: "directory", isSymbolicLink };
	}
	if (baseType === vscode.FileType.File) {
		return { kind: "file", isSymbolicLink };
	}
	return { kind: "unknown", isSymbolicLink };
}

async function getDirectoryUri(
	uri: vscode.Uri,
	fallbackToParentOnStatError: boolean,
): Promise<vscode.Uri> {
	try {
		const stat = await vscode.workspace.fs.stat(uri);
		if ((stat.type & vscode.FileType.Directory) !== 0) {
			return uri;
		}
		return getParentUri(uri) ?? uri;
	} catch {
		return fallbackToParentOnStatError ? (getParentUri(uri) ?? uri) : uri;
	}
}

async function statEntry(
	parentUri: vscode.Uri,
	name: string,
	fileType: vscode.FileType,
): Promise<DirectoryEntry> {
	const entryUri = vscode.Uri.joinPath(parentUri, name);
	const entryKind = getEntryKind(fileType);
	let size: number | null = null;
	let mtime: number | null = null;

	try {
		const stat = await vscode.workspace.fs.stat(entryUri);
		size = stat.size;
		mtime = stat.mtime;
	} catch {
		// Permission denied, broken symlink, deleted between readDirectory/stat, etc.
	}

	return {
		name,
		uri: entryUri.toString(),
		...entryKind,
		size,
		mtime,
	};
}

async function statEntries(
	rawEntries: [string, vscode.FileType][],
	parentUri: vscode.Uri,
	shouldCancel: () => boolean,
): Promise<DirectoryEntry[]> {
	const entries = new Array<DirectoryEntry>(rawEntries.length);
	let nextIndex = 0;

	const statNextEntry = async (): Promise<void> => {
		while (nextIndex < rawEntries.length) {
			if (shouldCancel()) {
				return;
			}
			const entryIndex = nextIndex++;
			const [name, fileType] = rawEntries[entryIndex];
			entries[entryIndex] = await statEntry(parentUri, name, fileType);
		}
	};

	const workerCount = Math.min(STAT_CONCURRENCY, rawEntries.length);
	await Promise.all(Array.from({ length: workerCount }, statNextEntry));
	return entries;
}

function getErrorText(error: unknown): string {
	if (error instanceof vscode.FileSystemError) {
		return error.code ?? error.message;
	}
	if (error instanceof Error) {
		return error.message;
	}
	return "Unknown error";
}

function getTerminalName(cwd: vscode.Uri): string {
	const basename = cwd.scheme === "file" ? path.basename(cwd.fsPath) : path.posix.basename(cwd.path);
	return basename || "Terminal";
}

function getNonce(): string {
	let text = "";
	for (let i = 0; i < NONCE_LENGTH; i++) {
		text += NONCE_CHARS.charAt(Math.floor(Math.random() * NONCE_CHARS.length));
	}
	return text;
}

class SherlockViewProvider implements vscode.WebviewViewProvider {
	private latestRequestId = -1;
	private watcher: vscode.FileSystemWatcher | undefined;
	private debounceTimer: ReturnType<typeof setTimeout> | undefined;

	readonly resolveWebviewView: vscode.WebviewViewProvider["resolveWebviewView"] =
		this.onResolveWebviewView.bind(this);

	constructor(private readonly extensionUri: vscode.Uri) {}

	private onResolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
		};

		webviewView.webview.html = this.getHtml(webviewView.webview);

		webviewView.webview.onDidReceiveMessage((message: unknown) => {
			if (!isWebviewToExtensionMessage(message)) {
				return;
			}
			void this.handleMessage(message, webviewView.webview);
		});

		webviewView.onDidDispose(() => {
			this.disposeWatcher();
		});
	}

	private async handleMessage(
		message: WebviewToExtensionMessage,
		webview: vscode.Webview,
	): Promise<void> {
		switch (message.type) {
			case "getInitialDirectory":
				this.postInitialDirectory(webview);
				return;
			case "readDirectory":
				await this.handleReadDirectory(message, webview);
				return;
			case "readAddress":
				await this.handleReadAddress(message, webview);
				return;
			case "openFile":
				await this.openResource(message.uri, false);
				return;
			case "openFileWith":
				await this.openResource(message.uri, true);
				return;
			case "copyPath":
				await this.copyPath(message);
				return;
			case "copyText":
				await vscode.env.clipboard.writeText(message.text);
				return;
			case "openDirectoryInTerminal":
				await this.openDirectoryInTerminal(message.uri);
				return;
		}
	}

	private postInitialDirectory(webview: vscode.Webview): void {
		postToWebview(webview, {
			type: "initialDirectory",
			uri: getInitialDirectoryUri().toString(),
		});
	}

	private async handleReadDirectory(
		message: Extract<WebviewToExtensionMessage, { type: "readDirectory" }>,
		webview: vscode.Webview,
	): Promise<void> {
		this.latestRequestId = message.requestId;
		const uri = parseUri(message.uri);

		if (!uri) {
			this.postDirectoryError(webview, message.requestId, message.uri, "Invalid URI");
			return;
		}

		await this.readAndPostDirectory(uri, message.requestId, webview, message.uri);
	}

	private async handleReadAddress(
		message: Extract<WebviewToExtensionMessage, { type: "readAddress" }>,
		webview: vscode.Webview,
	): Promise<void> {
		this.latestRequestId = message.requestId;

		const baseUri = message.baseUri ? parseUri(message.baseUri) : undefined;
		let uri: vscode.Uri;
		try {
			uri = resolveAddress(message.address, baseUri);
		} catch (error: unknown) {
			this.postDirectoryError(webview, message.requestId, message.address, getErrorText(error));
			return;
		}

		await this.readAndPostDirectory(uri, message.requestId, webview, message.address);
	}

	private async openResource(uriValue: string, openWithPicker: boolean): Promise<void> {
		const uri = parseUri(uriValue);
		if (!uri) {
			return;
		}

		if (!openWithPicker) {
			try {
				await vscode.commands.executeCommand("vscode.open", uri);
			} catch {
				// The default opener may reject unsupported or unavailable resources.
			}
			return;
		}

		try {
			await vscode.commands.executeCommand("vscode.open", uri);
			await vscode.commands.executeCommand("workbench.action.reopenWithEditor");
		} catch {
			try {
				await vscode.commands.executeCommand("vscode.open", uri);
			} catch {
				// Keep parity with the normal open path: no user-facing webview error.
			}
		}
	}

	private async copyPath(
		message: Extract<WebviewToExtensionMessage, { type: "copyPath" }>,
	): Promise<void> {
		const uri = parseUri(message.uri);
		if (!uri) {
			return;
		}

		const text =
			message.pathKind === "absolute" ? uri.fsPath : vscode.workspace.asRelativePath(uri, false);
		await vscode.env.clipboard.writeText(text);
	}

	private async openDirectoryInTerminal(uriValue: string): Promise<void> {
		const uri = parseUri(uriValue);
		if (!uri) {
			return;
		}

		const cwd = await getDirectoryUri(uri, true);
		const terminal = vscode.window.createTerminal({
			name: getTerminalName(cwd),
			cwd,
		});
		terminal.show();
	}

	private async readAndPostDirectory(
		uri: vscode.Uri,
		requestId: number,
		webview: vscode.Webview,
		errorUri: string,
	): Promise<void> {
		try {
			const directoryUri = await getDirectoryUri(uri, false);
			const rawEntries = await vscode.workspace.fs.readDirectory(directoryUri);
			if (requestId !== this.latestRequestId) {
				return;
			}
			const entries = await statEntries(
				rawEntries,
				directoryUri,
				() => requestId !== this.latestRequestId,
			);

			if (requestId !== this.latestRequestId) {
				return;
			}

			this.setupWatcher(directoryUri, webview);

			postToWebview(webview, {
				type: "directoryContents",
				requestId,
				uri: directoryUri.toString(),
				displayPath: getDisplayPath(directoryUri),
				entries,
				parentUri: getParentUriString(directoryUri),
				pathSegments: getPathSegments(directoryUri),
			});
		} catch (error: unknown) {
			if (requestId !== this.latestRequestId) {
				return;
			}
			this.postDirectoryError(webview, requestId, errorUri, getErrorText(error));
		}
	}

	private postDirectoryError(
		webview: vscode.Webview,
		requestId: number,
		uri: string,
		error: string,
	): void {
		postToWebview(webview, {
			type: "directoryError",
			requestId,
			uri,
			error,
		});
	}

	private setupWatcher(uri: vscode.Uri, webview: vscode.Webview): void {
		this.disposeWatcher();

		try {
			const pattern = new vscode.RelativePattern(uri, "*");
			this.watcher = vscode.workspace.createFileSystemWatcher(
				pattern,
				false, // create
				true, // change — ignored
				false, // delete
			);

			const notifyDirectoryChanged = (): void => {
				if (this.debounceTimer) {
					clearTimeout(this.debounceTimer);
				}
				this.debounceTimer = setTimeout(() => {
					postToWebview(webview, {
						type: "directoryChanged",
						uri: uri.toString(),
					});
				}, WATCHER_DEBOUNCE_MS);
			};

			this.watcher.onDidCreate(notifyDirectoryChanged);
			this.watcher.onDidDelete(notifyDirectoryChanged);
		} catch {
			// Some filesystem providers don't support watching.
		}
	}

	private disposeWatcher(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = undefined;
		}
		if (this.watcher) {
			this.watcher.dispose();
			this.watcher = undefined;
		}
	}

	private getHtml(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, "dist", "client", "main.js"),
		);
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, "dist", "client", "main.css"),
		);
		const nonce = getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<link rel="stylesheet" href="${styleUri}">
	<title>Sherlock</title>
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
	}

	dispose(): void {
		this.disposeWatcher();
	}
}

let provider: SherlockViewProvider | undefined;

function activate(context: vscode.ExtensionContext): void {
	provider = new SherlockViewProvider(context.extensionUri);
	context.subscriptions.push(vscode.window.registerWebviewViewProvider(VIEW_ID, provider));
}

function deactivate(): void {
	provider?.dispose();
}

export { activate, deactivate };
