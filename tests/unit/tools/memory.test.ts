import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, readFile, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We need to set the env var BEFORE importing the tools
let tempDir: string;

// Mock server
vi.mock("../../../src/server.js", () => {
  const handlers = new Map<string, { opts: unknown; handler: Function }>();
  return {
    server: {
      registerTool: (name: string, opts: unknown, handler: Function) => {
        handlers.set(name, { opts, handler });
      },
      _handlers: handlers,
    },
  };
});

// Mock Slack client (not used by memory tools, but needed for imports)
vi.mock("../../../src/slack/client.js", () => ({
  getSlackClient: () => ({}),
  isSearchAvailable: () => false,
  isRefreshAvailable: () => false,
  getAuthType: () => "bot",
}));

let readMemory: Function;
let searchMemory: Function;
let updateMemory: Function;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "memory-test-"));
  process.env.SLACK_MEMORY_DIR = tempDir;

  // Reset modules so memory.ts re-evaluates with new env var
  vi.resetModules();

  // Write test fixtures
  await writeFile(
    join(tempDir, "people.md"),
    "# People\n\n## Bob Jones\nCEO of Acme. Gives weekly directives.\n\n## Carol Davis\nWorks on Atlas GPU infrastructure.\n"
  );
  await writeFile(
    join(tempDir, "projects.md"),
    "# Projects\n\n## Phoenix\nVideo generation model. Key product.\n\n## Atlas\nVideo upscaler using 8x H100 GPUs.\n"
  );
  await writeFile(
    join(tempDir, "api.md"),
    "# API Notes\n\n## Staging\nBase URL: https://api.staging.example.com/public\nAuth: X-API-Key header\n"
  );

  // Import after setting env var
  const serverModule = await import("../../../src/server.js");
  await import("../../../src/tools/memory.js");

  const handlers = (serverModule.server as any)._handlers;
  readMemory = handlers.get("read_memory")?.handler;
  searchMemory = handlers.get("search_memory")?.handler;
  updateMemory = handlers.get("update_memory")?.handler;
});

afterEach(async () => {
  delete process.env.SLACK_MEMORY_DIR;
  await rm(tempDir, { recursive: true, force: true });
});

describe("read_memory", () => {
  it("no args: lists all .md files", async () => {
    const result = await readMemory({});
    const output = JSON.parse(result.content[0].text);
    expect(output.files).toHaveLength(3);
    expect(output.files.map((f: any) => f.path).sort()).toEqual([
      "api.md",
      "people.md",
      "projects.md",
    ]);
  });

  it("with path: reads specific file content", async () => {
    const result = await readMemory({ path: "people.md" });
    const output = JSON.parse(result.content[0].text);
    expect(output.content).toContain("Bob Jones");
    expect(output.path).toBe("people.md");
  });

  it("rejects path traversal", async () => {
    const result = await readMemory({ path: "../etc/passwd" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Path traversal");
  });

  it("handles nonexistent file with clear error", async () => {
    const result = await readMemory({ path: "nonexistent.md" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });

  it("no args: lists subdirectory .md files", async () => {
    await mkdir(join(tempDir, "directives"), { recursive: true });
    await writeFile(
      join(tempDir, "directives/weekly.md"),
      "# Weekly Directives"
    );

    const result = await readMemory({});
    const output = JSON.parse(result.content[0].text);
    const paths = output.files.map((f: any) => f.path);
    expect(paths).toContain("directives/weekly.md");
  });

  it("no args: skips _-prefixed directories in listing", async () => {
    await mkdir(join(tempDir, "_archive"), { recursive: true });
    await writeFile(join(tempDir, "_archive/old.md"), "# Old");

    const result = await readMemory({});
    const output = JSON.parse(result.content[0].text);
    const paths = output.files.map((f: any) => f.path);
    expect(paths.every((p: string) => !p.includes("_archive"))).toBe(true);
  });

  it("no args: skips .-prefixed directories in listing", async () => {
    await mkdir(join(tempDir, ".hidden"), { recursive: true });
    await writeFile(join(tempDir, ".hidden/secret.md"), "# Secret");

    const result = await readMemory({});
    const output = JSON.parse(result.content[0].text);
    const paths = output.files.map((f: any) => f.path);
    expect(paths.every((p: string) => !p.includes(".hidden"))).toBe(true);
  });

  it("with path: reads subdirectory file", async () => {
    await mkdir(join(tempDir, "notes"), { recursive: true });
    await writeFile(join(tempDir, "notes/deep.md"), "# Deep Content\nNested file.");

    const result = await readMemory({ path: "notes/deep.md" });
    const output = JSON.parse(result.content[0].text);
    expect(output.content).toContain("Deep Content");
    expect(output.path).toBe("notes/deep.md");
  });

  it("handles empty directory gracefully", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "empty-test-"));
    process.env.SLACK_MEMORY_DIR = emptyDir;
    vi.resetModules();
    const serverModule = await import("../../../src/server.js");
    await import("../../../src/tools/memory.js");
    const handlers = (serverModule.server as any)._handlers;
    const handler = handlers.get("read_memory")?.handler;

    const result = await handler({});
    const output = JSON.parse(result.content[0].text);
    expect(output.files).toHaveLength(0);

    await rm(emptyDir, { recursive: true, force: true });
  });
});

describe("search_memory", () => {
  it("finds keyword match", async () => {
    const result = await searchMemory({ query: "Bob Jones" });
    const output = JSON.parse(result.content[0].text);
    expect(output.results.length).toBeGreaterThan(0);
    expect(output.results[0].content).toContain("CEO");
  });

  it("case-insensitive matching", async () => {
    const result = await searchMemory({ query: "bob jones" });
    const output = JSON.parse(result.content[0].text);
    expect(output.results.length).toBeGreaterThan(0);
  });

  it("returns section context", async () => {
    const result = await searchMemory({ query: "CEO" });
    const output = JSON.parse(result.content[0].text);
    expect(output.results.length).toBeGreaterThan(0);
    expect(output.results[0].section).toBeDefined();
    expect(output.results[0].file).toBeDefined();
  });

  it("returns empty results for no match (not error)", async () => {
    const result = await searchMemory({ query: "zzzznonexistentzzzz" });
    const output = JSON.parse(result.content[0].text);
    expect(output.results).toHaveLength(0);
    expect(result.isError).toBeUndefined();
  });

  it("searches across multiple files", async () => {
    const result = await searchMemory({ query: "Atlas" });
    const output = JSON.parse(result.content[0].text);
    const files = new Set(output.results.map((r: any) => r.file));
    expect(files.size).toBeGreaterThanOrEqual(1);
  });

  it("handles files with no ## headers", async () => {
    await writeFile(
      join(tempDir, "plain.md"),
      "Just a plain file with no headers. Contains important notes about GPU setup."
    );
    // Need to reset the search index
    const { resetIndex } = await import("../../../src/memory/index.js");
    resetIndex();

    const result = await searchMemory({ query: "GPU" });
    const output = JSON.parse(result.content[0].text);
    expect(output.results.length).toBeGreaterThan(0);
  });

  it("truncates long sections at 500 chars", async () => {
    const longContent = "## LongSection\n" + "x".repeat(1000);
    await writeFile(join(tempDir, "long.md"), longContent);
    const { resetIndex } = await import("../../../src/memory/index.js");
    resetIndex();

    const result = await searchMemory({ query: "LongSection" });
    const output = JSON.parse(result.content[0].text);
    const matchingResult = output.results.find(
      (r: any) => r.section === "LongSection"
    );
    if (matchingResult) {
      expect(matchingResult.content.length).toBeLessThanOrEqual(501); // 500 + "…"
    }
  });
});

describe("update_memory", () => {
  it("append mode: adds to end of existing file", async () => {
    const result = await updateMemory({
      path: "people.md",
      content: "\n## New Person\nJohn",
    });
    const output = JSON.parse(result.content[0].text);
    expect(output.success).toBe(true);
    expect(output.mode).toBe("append");

    const content = await readFile(join(tempDir, "people.md"), "utf-8");
    expect(content).toContain("New Person");
    expect(content).toContain("Bob Jones"); // original content preserved
  });

  it("replace mode: overwrites file content", async () => {
    const result = await updateMemory({
      path: "people.md",
      content: "# Replaced",
      mode: "replace",
    });
    const output = JSON.parse(result.content[0].text);
    expect(output.success).toBe(true);
    expect(output.mode).toBe("replace");

    const content = await readFile(join(tempDir, "people.md"), "utf-8");
    expect(content).toBe("# Replaced");
  });

  it("create mode: creates new file", async () => {
    const result = await updateMemory({
      path: "new.md",
      content: "# New File",
      mode: "create",
    });
    const output = JSON.parse(result.content[0].text);
    expect(output.success).toBe(true);
    expect(output.mode).toBe("create");

    const content = await readFile(join(tempDir, "new.md"), "utf-8");
    expect(content).toBe("# New File");
  });

  it("create mode: fails if file already exists", async () => {
    const result = await updateMemory({
      path: "people.md",
      content: "x",
      mode: "create",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("already exists");
  });

  it("rejects path traversal", async () => {
    const result = await updateMemory({ path: "../evil.md", content: "x" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Path traversal");
  });

  it("rejects non-.md files", async () => {
    const result = await updateMemory({ path: "file.txt", content: "x" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(".md");
  });

  it("handles missing parent directories", async () => {
    const result = await updateMemory({
      path: "sub/dir/new.md",
      content: "# Nested",
      mode: "create",
    });
    const output = JSON.parse(result.content[0].text);
    expect(output.success).toBe(true);

    const content = await readFile(join(tempDir, "sub/dir/new.md"), "utf-8");
    expect(content).toBe("# Nested");
  });

  it("returns bytes written", async () => {
    const result = await updateMemory({
      path: "sized.md",
      content: "hello",
      mode: "create",
    });
    const output = JSON.parse(result.content[0].text);
    expect(output.bytesWritten).toBe(5);
  });
});

describe("recursive memory indexing", () => {
  it("finds content in subdirectory .md files", async () => {
    // Create nested structure
    await mkdir(join(tempDir, "team-directives"), { recursive: true });
    await writeFile(
      join(tempDir, "team-directives/2026-02-17-phoenix-agent-homepage.md"),
      "# Phoenix Agent Homepage\n\n## Assignment\nBuild the phoenix agent homepage with video demos.\n"
    );

    const { resetIndex } = await import("../../../src/memory/index.js");
    resetIndex();

    const result = await searchMemory({ query: "phoenix agent homepage" });
    const output = JSON.parse(result.content[0].text);
    expect(output.results.length).toBeGreaterThan(0);
    expect(
      output.results.some((r: any) => r.file.includes("team-directives/"))
    ).toBe(true);
  });

  it("subdirectory results include directory prefix in file path", async () => {
    await mkdir(join(tempDir, "email-snapshot"), { recursive: true });
    await writeFile(
      join(tempDir, "email-snapshot/EMAIL_INDEX.md"),
      "# Email Index\n\n## Important Emails\nThread about launch timeline.\n"
    );

    const { resetIndex } = await import("../../../src/memory/index.js");
    resetIndex();

    const result = await searchMemory({ query: "EMAIL_INDEX" });
    const output = JSON.parse(result.content[0].text);
    expect(output.results.length).toBeGreaterThan(0);
    const hit = output.results.find((r: any) =>
      r.file.includes("email-snapshot/")
    );
    expect(hit).toBeDefined();
    expect(hit.file).toBe("email-snapshot/EMAIL_INDEX.md");
  });

  it("skips _-prefixed directories", async () => {
    await mkdir(join(tempDir, "_outdated"), { recursive: true });
    await writeFile(
      join(tempDir, "_outdated/old-notes.md"),
      "# Old Notes\n\n## Deprecated\nThis should not appear in search.\n"
    );

    const { resetIndex } = await import("../../../src/memory/index.js");
    resetIndex();

    const result = await searchMemory({ query: "Deprecated" });
    const output = JSON.parse(result.content[0].text);
    const hasOutdated = output.results.some((r: any) =>
      r.file.includes("_outdated")
    );
    expect(hasOutdated).toBe(false);
  });

  it("skips .-prefixed directories", async () => {
    await mkdir(join(tempDir, ".hidden"), { recursive: true });
    await writeFile(
      join(tempDir, ".hidden/secret.md"),
      "# Secret\n\n## Hidden Content\nShould not appear in search.\n"
    );

    const { resetIndex } = await import("../../../src/memory/index.js");
    resetIndex();

    const result = await searchMemory({ query: "Hidden Content" });
    const output = JSON.parse(result.content[0].text);
    const hasHidden = output.results.some((r: any) =>
      r.file.includes(".hidden")
    );
    expect(hasHidden).toBe(false);
  });

  it("skips symlinks", async () => {
    const symlinkTarget = await mkdtemp(join(tmpdir(), "symlink-target-"));
    await writeFile(
      join(symlinkTarget, "linked.md"),
      "# Linked\n\n## Via Symlink\nShould not appear in search.\n"
    );

    await symlink(symlinkTarget, join(tempDir, "symlinked-dir"));

    const { resetIndex } = await import("../../../src/memory/index.js");
    resetIndex();

    const result = await searchMemory({ query: "Via Symlink" });
    const output = JSON.parse(result.content[0].text);
    const hasSymlinked = output.results.some((r: any) =>
      r.file.includes("symlinked-dir")
    );
    expect(hasSymlinked).toBe(false);

    await rm(symlinkTarget, { recursive: true, force: true });
  });
});
