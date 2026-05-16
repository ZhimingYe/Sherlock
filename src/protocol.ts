export type DirectoryEntry = {
	name: string;
	uri: string;
	kind: "file" | "directory" | "unknown";
	isSymbolicLink: boolean;
	size: number | null;
	mtime: number | null;
};

export type PathSegment = {
	label: string;
	uri: string;
};

export type PathKind = "absolute" | "relative";

export type WebviewToExtensionMessage =
	| { type: "getInitialDirectory" }
	| { type: "readDirectory"; requestId: number; uri: string }
	| { type: "readAddress"; requestId: number; address: string; baseUri: string }
	| { type: "openFile"; uri: string }
	| { type: "openFileWith"; uri: string }
	| { type: "openDirectoryInTerminal"; uri: string }
	| { type: "copyText"; text: string }
	| { type: "copyPath"; uri: string; pathKind: PathKind };

export type ExtensionToWebviewMessage =
	| { type: "initialDirectory"; uri: string }
	| {
			type: "directoryContents";
			requestId: number;
			uri: string;
			displayPath: string;
			entries: DirectoryEntry[];
			parentUri: string | null;
			pathSegments: PathSegment[];
	  }
	| { type: "directoryError"; requestId: number; uri: string; error: string }
	| { type: "directoryChanged"; uri: string };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(record: UnknownRecord, key: string): boolean {
	return typeof record[key] === "string";
}

function isNullableNumber(value: unknown): value is number | null {
	return value === null || (typeof value === "number" && Number.isFinite(value));
}

function hasRequestId(record: UnknownRecord): boolean {
	const requestId = record.requestId;
	return typeof requestId === "number" && Number.isInteger(requestId) && requestId >= 0;
}

function hasNullableString(record: UnknownRecord, key: string): boolean {
	const value = record[key];
	return value === null || typeof value === "string";
}

function isPathKind(value: unknown): value is PathKind {
	return value === "absolute" || value === "relative";
}

function isDirectoryKind(value: unknown): value is DirectoryEntry["kind"] {
	return value === "file" || value === "directory" || value === "unknown";
}

function isDirectoryEntry(value: unknown): value is DirectoryEntry {
	if (!isRecord(value)) {
		return false;
	}
	return (
		hasString(value, "name") &&
		hasString(value, "uri") &&
		isDirectoryKind(value.kind) &&
		typeof value.isSymbolicLink === "boolean" &&
		isNullableNumber(value.size) &&
		isNullableNumber(value.mtime)
	);
}

function isPathSegment(value: unknown): value is PathSegment {
	return isRecord(value) && hasString(value, "label") && hasString(value, "uri");
}

function isDirectoryEntries(value: unknown): value is DirectoryEntry[] {
	return Array.isArray(value) && value.every(isDirectoryEntry);
}

function isPathSegments(value: unknown): value is PathSegment[] {
	return Array.isArray(value) && value.every(isPathSegment);
}

function isWebviewToExtensionMessage(
	message: unknown,
): message is WebviewToExtensionMessage {
	if (!isRecord(message) || !hasString(message, "type")) {
		return false;
	}

	switch (message.type) {
		case "getInitialDirectory":
			return true;
		case "readDirectory":
			return hasRequestId(message) && hasString(message, "uri");
		case "readAddress":
			return (
				hasRequestId(message) &&
				hasString(message, "address") &&
				hasString(message, "baseUri")
			);
		case "openFile":
		case "openFileWith":
		case "openDirectoryInTerminal":
			return hasString(message, "uri");
		case "copyText":
			return hasString(message, "text");
		case "copyPath":
			return hasString(message, "uri") && isPathKind(message.pathKind);
		default:
			return false;
	}
}

function isExtensionToWebviewMessage(
	message: unknown,
): message is ExtensionToWebviewMessage {
	if (!isRecord(message) || !hasString(message, "type")) {
		return false;
	}

	switch (message.type) {
		case "initialDirectory":
			return hasString(message, "uri");
		case "directoryContents":
			return (
				hasRequestId(message) &&
				hasString(message, "uri") &&
				hasString(message, "displayPath") &&
				isDirectoryEntries(message.entries) &&
				hasNullableString(message, "parentUri") &&
				isPathSegments(message.pathSegments)
			);
		case "directoryError":
			return hasRequestId(message) && hasString(message, "uri") && hasString(message, "error");
		case "directoryChanged":
			return hasString(message, "uri");
		default:
			return false;
	}
}

export { isExtensionToWebviewMessage, isWebviewToExtensionMessage };
