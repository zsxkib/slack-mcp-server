import { z } from "zod";
import { server } from "../server.js";
import { getMemoryDir, isMemoryAvailable } from "../config/memory.js";
import { searchMemory, walkMdFiles } from "../memory/index.js";
import { readFile, writeFile, stat, mkdir, realpath } from "node:fs/promises";
import { resolve, relative, dirname, basename } from "node:path";
import { logError } from "../utils/error-log.js";

/**
 * Security: validates that a path stays within the memory directory.
 * Checks both lexical path traversal and symlink escape.
 */
async function validatePath(memoryDir: string, inputPath: string): Promise<string> {
  const resolved = resolve(memoryDir, inputPath);
  const rel = relative(memoryDir, resolved);
  if (rel.startsWith("..") || resolve(memoryDir, rel) !== resolved) {
    throw new Error("Path traversal not allowed");
  }

  // Check symlink escape: resolve real path of file (or parent dir if file doesn't exist)
  try {
    const realMemoryDir = await realpath(memoryDir);
    let realTarget: string;
    try {
      realTarget = await realpath(resolved);
    } catch (fileErr) {
      if ((fileErr as NodeJS.ErrnoException).code !== "ENOENT") throw fileErr;
      // File doesn't exist — check parent directory instead (covers symlinked dirs)
      realTarget = resolve(await realpath(dirname(resolved)), basename(resolved));
    }
    const realRel = relative(realMemoryDir, realTarget);
    if (realRel.startsWith("..")) {
      throw new Error("Path traversal not allowed");
    }
  } catch (e) {
    if (e instanceof Error && e.message === "Path traversal not allowed") throw e;
    // If parent dir also doesn't exist, lexical check above is sufficient
    if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") {
      // Parent doesn't exist — will fail at read/write time, that's fine
    } else if (e instanceof Error && "code" in e) {
      throw e;
    }
  }

  return resolved;
}

function formatError(message: string, tool?: string) {
  logError({
    level: "error",
    component: "Memory",
    code: "MEMORY_ERROR",
    message,
    tool,
  });
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

if (isMemoryAvailable()) {
  // ── read_memory ──
  server.registerTool(
    "read_memory",
    {
      description:
        "Read persistent workspace memory. No args: list all files (including subdirectories). " +
        "With path: read specific file. Use search_memory to find content by keyword instead of reading every file.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe(
            "File path relative to memory dir (e.g. 'people.md', 'meeting-notes/2026-02-17-project-kickoff.md')"
          ),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ path }) => {
      const memoryDir = getMemoryDir()!;

      try {
        if (!path) {
          // List all .md files recursively
          const fileInfos: { path: string; size: number; preview: string }[] = [];
          for await (const { absPath, relPath } of walkMdFiles(memoryDir, memoryDir)) {
            const fileStat = await stat(absPath);
            const content = await readFile(absPath, "utf-8");
            const firstLine =
              content.split("\n").find((l) => l.trim().length > 0) ?? "";
            fileInfos.push({
              path: relPath,
              size: fileStat.size,
              preview: firstLine.slice(0, 100),
            });
          }
          fileInfos.sort((a, b) => a.path.localeCompare(b.path));

          const output = { files: fileInfos };
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(output),
              },
            ],
            structuredContent: output,
          };
        }

        // Read specific file — validate traversal before extension
        const filePath = await validatePath(memoryDir, path);
        if (!path.endsWith(".md")) {
          return formatError("Only .md files are allowed", "read_memory");
        }
        const content = await readFile(filePath, "utf-8");
        const output = { path, content };
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(output) },
          ],
          structuredContent: output,
        };
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Path traversal not allowed"
        ) {
          return formatError("Path traversal not allowed");
        }
        if (
          error instanceof Error &&
          "code" in error &&
          (error as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          return formatError(`File not found: ${path}`);
        }
        return formatError(
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  );

  // ── search_memory ──
  server.registerTool(
    "search_memory",
    {
      description:
        "Full-text search across workspace memory files (including subdirectories). " +
        "Supports fuzzy matching and partial words. Returns ranked sections. " +
        "Prefer this over read_memory when looking for specific topics.",
      inputSchema: {
        query: z
          .string()
          .describe(
            "Search query (e.g. 'onboarding', 'API keys', 'deploy process')"
          ),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ query }) => {
      const memoryDir = getMemoryDir()!;

      try {
        const result = await searchMemory(memoryDir, query);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result) },
          ],
          structuredContent: result,
        };
      } catch (error) {
        return formatError(
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  );

  // ── update_memory ──
  server.registerTool(
    "update_memory",
    {
      description:
        "Update workspace memory files. Modes: 'append' (default) adds to end, " +
        "'replace' overwrites file, 'create' creates new file (fails if exists). " +
        "Only .md files allowed.",
      inputSchema: {
        path: z
          .string()
          .describe("File path relative to memory dir (e.g. 'notes.md')"),
        content: z.string().describe("Content to write"),
        mode: z
          .enum(["append", "replace", "create"])
          .optional()
          .describe("Write mode (default: append)"),
      },
      annotations: {
        destructiveHint: false,
      },
    },
    async ({ path, content, mode }) => {
      const memoryDir = getMemoryDir()!;
      const writeMode = mode ?? "append";

      try {
        // Validate .md extension
        if (!path.endsWith(".md")) {
          return formatError("Only .md files are allowed");
        }

        const filePath = await validatePath(memoryDir, path);

        // Ensure parent directory exists
        await mkdir(dirname(filePath), { recursive: true });

        if (writeMode === "create") {
          try {
            await stat(filePath);
            return formatError(`File already exists: ${path}`);
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
          }
          await writeFile(filePath, content, "utf-8");
        } else if (writeMode === "replace") {
          await writeFile(filePath, content, "utf-8");
        } else {
          // append
          let existing = "";
          try {
            existing = await readFile(filePath, "utf-8");
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
          }
          const newContent = existing ? existing + "\n" + content : content;
          await writeFile(filePath, newContent, "utf-8");
        }

        const fileStat = await stat(filePath);
        const output = {
          success: true,
          path,
          mode: writeMode,
          bytesWritten: fileStat.size,
        };
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(output) },
          ],
          structuredContent: output,
        };
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Path traversal not allowed"
        ) {
          return formatError("Path traversal not allowed");
        }
        return formatError(
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  );
}
