import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { searchMemory, resetIndex } from "../../src/memory/index.js";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let MEMORY_DIR: string;

beforeAll(async () => {
  MEMORY_DIR = await mkdtemp(join(tmpdir(), "memory-search-integration-"));

  // Create fixture files that mirror a realistic memory directory
  await writeFile(
    join(MEMORY_DIR, "people.md"),
    "# People\n\n## Bob Jones\nCEO of Acme. Gives weekly directives.\nKey decision maker for product direction.\n\n## Carol Davis\nWorks on Atlas GPU infrastructure.\nManages the 8x H100 cluster.\n\n## Engineers\nSmall team focused on video generation.\n"
  );

  await writeFile(
    join(MEMORY_DIR, "projects.md"),
    "# Projects\n\n## Phoenix\nVideo generation model. Key product for Acme.\nUsed in the main pipeline.\n\n## Atlas\nVideo upscaler using 8x H100 GPUs.\nIntegrates with Phoenix for end-to-end workflow.\n"
  );

  await writeFile(
    join(MEMORY_DIR, "api.md"),
    "# API Notes\n\n## Staging\nBase URL: https://api.staging.example.com/public\nAuth: X-API-Key header\n\n## Production\nSame pattern, different base URL.\n"
  );

  await writeFile(
    join(MEMORY_DIR, "company.md"),
    "# Acme\n\n## Overview\nAcme builds AI video tools.\nFounded by Bob Jones.\n\n## Products\nPhoenix (video generation), Atlas (upscaling).\n"
  );

  await writeFile(
    join(MEMORY_DIR, "gpu.md"),
    "# GPU Infrastructure\n\n## Setup\n8x H100 80GB on vast.ai node.\nUsed for Atlas video upscaling.\n\n## Access\nSSH alias configured for remote access.\n"
  );

  await mkdir(join(MEMORY_DIR, "team-directives"), { recursive: true });
  await writeFile(
    join(MEMORY_DIR, "team-directives/2026-02-17-phoenix-agent-homepage.md"),
    "# Phoenix Agent Homepage\n\n## Assignment\nBuild the phoenix agent homepage with video demos.\nDeadline: end of week.\n\n## Requirements\nShowcase Phoenix capabilities with live examples.\n"
  );
});

afterAll(async () => {
  await rm(MEMORY_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  resetIndex();
});

describe("memory search calibration against fixture data", () => {
  it("'Bob Jones' returns relevant results from people/company files", async () => {
    const r = await searchMemory(MEMORY_DIR, "Bob Jones");
    expect(r.total).toBeGreaterThan(0);
    // Should find Bob Jones in people-related content
    const files = r.results.map((h) => h.file);
    expect(
      files.some(
        (f) =>
          f.includes("people") ||
          f.includes("company") ||
          f.includes("role")
      )
    ).toBe(true);
  });

  it("'phoenix' returns relevant results", async () => {
    const r = await searchMemory(MEMORY_DIR, "phoenix");
    expect(r.total).toBeGreaterThan(0);
    const allContent = r.results.map((h) => h.content.toLowerCase()).join(" ");
    expect(allContent).toContain("phoenix");
  });

  it("'Atlas' returns relevant results", async () => {
    const r = await searchMemory(MEMORY_DIR, "Atlas");
    expect(r.total).toBeGreaterThan(0);
  });

  it("'staging API' returns relevant results", async () => {
    const r = await searchMemory(MEMORY_DIR, "staging API");
    expect(r.total).toBeGreaterThan(0);
  });

  it("'GPU' returns relevant results", async () => {
    const r = await searchMemory(MEMORY_DIR, "GPU");
    expect(r.total).toBeGreaterThan(0);
  });

  it("partial word prefix search: 'phoe' matches Phoenix content", async () => {
    const r = await searchMemory(MEMORY_DIR, "phoe");
    expect(r.total).toBeGreaterThan(0);
  });

  it("fuzzy search: 'atlas' matches Atlas content", async () => {
    const r = await searchMemory(MEMORY_DIR, "atlas");
    expect(r.total).toBeGreaterThan(0);
  });

  it("results are ranked by relevance (best match first)", async () => {
    const r = await searchMemory(MEMORY_DIR, "Bob Jones");
    expect(r.results.length).toBeGreaterThanOrEqual(2);
    // Scores should be descending
    for (let i = 1; i < r.results.length; i++) {
      expect(r.results[i - 1]!.score).toBeGreaterThanOrEqual(
        r.results[i]!.score
      );
    }
  });

  it("no matches returns empty results (not error)", async () => {
    const r = await searchMemory(MEMORY_DIR, "qqzzxxwwvv");
    expect(r.results).toEqual([]);
    expect(r.total).toBe(0);
  });

  it("search across multiple files returns results from multiple files", async () => {
    // "Acme" should appear in many files
    const r = await searchMemory(MEMORY_DIR, "Acme");
    expect(r.total).toBeGreaterThan(0);
    const uniqueFiles = new Set(r.results.map((h) => h.file));
    expect(uniqueFiles.size).toBeGreaterThanOrEqual(2);
  });

  it("section headers appear in results", async () => {
    const r = await searchMemory(MEMORY_DIR, "Bob Jones");
    expect(r.total).toBeGreaterThan(0);
    // At least one result should have a non-empty section name
    expect(r.results.some((h) => h.section.length > 0)).toBe(true);
  });

  it("results respect max content length cap (500 chars)", async () => {
    const r = await searchMemory(MEMORY_DIR, "Acme");
    for (const hit of r.results) {
      // 500 chars + possible ellipsis character
      expect(hit.content.length).toBeLessThanOrEqual(501);
    }
  });

  it("max 10 results returned", async () => {
    const r = await searchMemory(MEMORY_DIR, "Acme");
    expect(r.results.length).toBeLessThanOrEqual(10);
  });

  it("finds content in team-directives/ subdirectory", async () => {
    const r = await searchMemory(MEMORY_DIR, "phoenix agent homepage");
    expect(r.total).toBeGreaterThan(0);
    const hit = r.results.find((h) => h.file.includes("team-directives/"));
    expect(hit).toBeDefined();
  });

  it("subdirectory results include directory prefix in file path", async () => {
    const r = await searchMemory(MEMORY_DIR, "phoenix agent homepage");
    expect(r.total).toBeGreaterThan(0);
    const hit = r.results.find((h) => h.file.includes("team-directives/"));
    expect(hit).toBeDefined();
    expect(hit!.file).toMatch(/^team-directives\//);
  });
});
