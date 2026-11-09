/**
 * Virtual Filesystem security, path traversal protection, and resource quota guards.
 * Used across the Monaco IDE workspace, Pyodide Web Worker, and test harnesses.
 */

export const VFS_LIMITS = {
  MAX_FILES: 20,
  MAX_FILE_BYTES: 64 * 1024, // 64 KB per file
  MAX_TOTAL_WORKSPACE_BYTES: 256 * 1024, // 256 KB total across workspace
  MAX_FILENAME_LENGTH: 64,
  ALLOWED_FILENAME_REGEX: /^[a-zA-Z0-9_\-.][a-zA-Z0-9_\-./]*[a-zA-Z0-9_\-.]*$/,
} as const;

export class VirtualFsError extends Error {
  constructor(
    message: string,
    public code: "INVALID_PATH" | "FILE_COUNT_EXCEEDED" | "FILE_SIZE_EXCEEDED" | "WORKSPACE_SIZE_EXCEEDED"
  ) {
    super(message);
    this.name = "VirtualFsError";
  }
}

/** Validates a relative file path against directory traversal and illegal characters. */
export function validateVirtualPath(path: string): void {
  if (!path || typeof path !== "string") {
    throw new VirtualFsError("Filename must be a non-empty string.", "INVALID_PATH");
  }
  const clean = path.trim();
  if (clean.length > VFS_LIMITS.MAX_FILENAME_LENGTH) {
    throw new VirtualFsError(
      `Filename exceeds maximum length of ${VFS_LIMITS.MAX_FILENAME_LENGTH} characters.`,
      "INVALID_PATH"
    );
  }
  if (clean.includes("\0")) {
    throw new VirtualFsError("Null bytes are not permitted in file paths.", "INVALID_PATH");
  }
  if (clean.startsWith("/") || clean.startsWith("\\") || /^[a-zA-Z]:/.test(clean)) {
    throw new VirtualFsError("Absolute paths are not permitted in the virtual workspace.", "INVALID_PATH");
  }
  // Check traversal segments
  const segments = clean.split(/[/\\]/);
  for (const seg of segments) {
    if (seg === ".." || seg === ".") {
      throw new VirtualFsError("Path traversal (..) is not permitted.", "INVALID_PATH");
    }
    if (!seg) {
      throw new VirtualFsError("Empty directory segments are not permitted.", "INVALID_PATH");
    }
  }
  if (!VFS_LIMITS.ALLOWED_FILENAME_REGEX.test(clean)) {
    throw new VirtualFsError(`Filename "${clean}" contains invalid characters.`, "INVALID_PATH");
  }
}

/** Validates an entire workspace file dictionary against quotas and security constraints. */
export function validateWorkspaceFiles(files?: Record<string, string>): void {
  if (!files) return;
  const entries = Object.entries(files);
  if (entries.length > VFS_LIMITS.MAX_FILES) {
    throw new VirtualFsError(
      `Workspace exceeds maximum limit of ${VFS_LIMITS.MAX_FILES} files.`,
      "FILE_COUNT_EXCEEDED"
    );
  }
  let totalBytes = 0;
  for (const [name, content] of entries) {
    validateVirtualPath(name);
    const byteLength = new TextEncoder().encode(content || "").length;
    if (byteLength > VFS_LIMITS.MAX_FILE_BYTES) {
      throw new VirtualFsError(
        `File "${name}" exceeds size limit of ${VFS_LIMITS.MAX_FILE_BYTES / 1024} KB.`,
        "FILE_SIZE_EXCEEDED"
      );
    }
    totalBytes += byteLength;
    if (totalBytes > VFS_LIMITS.MAX_TOTAL_WORKSPACE_BYTES) {
      throw new VirtualFsError(
        `Total workspace size exceeds limit of ${VFS_LIMITS.MAX_TOTAL_WORKSPACE_BYTES / 1024} KB.`,
        "WORKSPACE_SIZE_EXCEEDED"
      );
    }
  }
}

