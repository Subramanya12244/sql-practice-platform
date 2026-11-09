import { describe, expect, it } from "vitest";
import { validateVirtualPath, validateWorkspaceFiles, VirtualFsError, VFS_LIMITS } from "../site/lib/virtualFs";

describe("VirtualFS Security & Quota Validation", () => {
  describe("validateVirtualPath", () => {
    it("accepts valid relative filenames and internal directories", () => {
      const valid = [
        "solution.py",
        "main.py",
        "helper.py",
        "data.csv",
        "config.json",
        "nested/module.py",
        "utils/helpers/parser.py",
        "test-case_1.txt",
      ];
      valid.forEach((name) => {
        expect(() => validateVirtualPath(name)).not.toThrow();
      });
    });

    it("rejects path traversal attempts with .. or .", () => {
      const traversals = [
        "../outside.py",
        "../../etc/passwd",
        "nested/../../secret.py",
        "./current.py",
        "foo/../bar.py",
      ];
      traversals.forEach((name) => {
        expect(() => validateVirtualPath(name)).toThrowError(VirtualFsError);
        expect(() => validateVirtualPath(name)).toThrow(/Path traversal/);
      });
    });

    it("rejects absolute paths on Unix and Windows", () => {
      const absolutes = [
        "/etc/passwd",
        "/var/log/syslog",
        "\\Windows\\System32",
        "C:\\Users\\Admin\\file.py",
        "D:/test.py",
      ];
      absolutes.forEach((name) => {
        expect(() => validateVirtualPath(name)).toThrowError(VirtualFsError);
        expect(() => validateVirtualPath(name)).toThrow(/Absolute paths/);
      });
    });

    it("rejects null bytes and illegal characters", () => {
      expect(() => validateVirtualPath("bad\0file.py")).toThrow(/Null bytes/);
      expect(() => validateVirtualPath("bad*name.py")).toThrow(/invalid characters/);
      expect(() => validateVirtualPath("file?.py")).toThrow(/invalid characters/);
      expect(() => validateVirtualPath("file<1>.py")).toThrow(/invalid characters/);
    });

    it("enforces maximum filename length", () => {
      const longName = "a".repeat(VFS_LIMITS.MAX_FILENAME_LENGTH + 1) + ".py";
      expect(() => validateVirtualPath(longName)).toThrow(/maximum length/);
    });
  });

  describe("validateWorkspaceFiles quotas", () => {
    it("passes for valid workspace structures within limits", () => {
      const workspace: Record<string, string> = {
        "solution.py": "def solve():\n    return 42\n",
        "main.py": "from solution import solve\nprint(solve())\n",
        "helper.py": "# Shared utilities\n",
        "data.csv": "id,name,value\n1,alpha,100\n",
      };
      expect(() => validateWorkspaceFiles(workspace)).not.toThrow();
    });

    it("rejects workspaces exceeding max file count limit", () => {
      const tooManyFiles: Record<string, string> = {};
      for (let i = 0; i < VFS_LIMITS.MAX_FILES + 1; i++) {
        tooManyFiles[`file_${i}.py`] = "print('ok')\n";
      }
      expect(() => validateWorkspaceFiles(tooManyFiles)).toThrowError(VirtualFsError);
      expect(() => validateWorkspaceFiles(tooManyFiles)).toThrow(/maximum limit of 20 files/);
    });

    it("rejects individual files exceeding per-file size quota", () => {
      const largeContent = "x".repeat(VFS_LIMITS.MAX_FILE_BYTES + 10);
      const workspace = {
        "solution.py": largeContent,
      };
      expect(() => validateWorkspaceFiles(workspace)).toThrowError(VirtualFsError);
      expect(() => validateWorkspaceFiles(workspace)).toThrow(/exceeds size limit of 64 KB/);
    });

    it("rejects total workspace exceeding aggregate quota", () => {
      // 5 files each of 60 KB = 300 KB > 256 KB total limit
      const sixtyKb = "y".repeat(60 * 1024);
      const workspace = {
        "file1.py": sixtyKb,
        "file2.py": sixtyKb,
        "file3.py": sixtyKb,
        "file4.py": sixtyKb,
        "file5.py": sixtyKb,
      };
      expect(() => validateWorkspaceFiles(workspace)).toThrowError(VirtualFsError);
      expect(() => validateWorkspaceFiles(workspace)).toThrow(/Total workspace size exceeds limit of 256 KB/);
    });
  });
});

