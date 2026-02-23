import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

/**
 * Recursively walks a directory yielding .md files.
 * Skips symlinks, and directories starting with '_' or '.'.
 */
export async function* walkMdFiles(
  dir: string,
  rootDir: string
): AsyncGenerator<{ absPath: string; relPath: string }> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
    const absPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkMdFiles(absPath, rootDir);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      yield { absPath, relPath: relative(rootDir, absPath) };
    }
    // Symlinks (entry.isSymbolicLink()) silently skipped
  }
}
import MiniSearch from "minisearch";

interface SearchDocument {
  id: string;
  title: string;
  content: string;
  file: string;
}

interface FileState {
  mtimeMs: number;
}

let index: MiniSearch<SearchDocument> | null = null;
let fileStates: Map<string, FileState> = new Map();
let indexDir: string | null = null;

/**
 * Splits markdown content into sections by ## headers.
 * Files without ## headers are treated as a single section.
 */
function splitSections(content: string, filePath: string): SearchDocument[] {
  const sections: SearchDocument[] = [];
  const lines = content.split("\n");
  let currentTitle = filePath;
  let currentContent: string[] = [];
  let sectionIndex = 0;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      // Save previous section
      if (currentContent.length > 0) {
        sections.push({
          id: `${filePath}:${sectionIndex}`,
          title: currentTitle,
          content: currentContent.join("\n").trim(),
          file: filePath,
        });
        sectionIndex++;
      }
      currentTitle = line.replace(/^##\s+/, "").trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  // Save last section
  if (currentContent.length > 0 || sections.length === 0) {
    sections.push({
      id: `${filePath}:${sectionIndex}`,
      title: currentTitle,
      content: currentContent.join("\n").trim(),
      file: filePath,
    });
  }

  return sections;
}

/**
 * Checks if the index needs rebuilding by comparing file mtimes.
 */
async function needsRebuild(dir: string): Promise<boolean> {
  if (index === null || indexDir !== dir) return true;

  try {
    const currentFiles = new Map<string, number>();
    for await (const { absPath, relPath } of walkMdFiles(dir, dir)) {
      const fileStat = await stat(absPath);
      currentFiles.set(relPath, fileStat.mtimeMs);
    }

    if (currentFiles.size !== fileStates.size) return true;

    for (const [path, mtimeMs] of currentFiles) {
      const cached = fileStates.get(path);
      if (!cached || cached.mtimeMs !== mtimeMs) return true;
    }

    return false;
  } catch {
    return true;
  }
}

/**
 * Builds or rebuilds the search index from all .md files in the directory.
 */
async function buildIndex(dir: string): Promise<void> {
  const newIndex = new MiniSearch<SearchDocument>({
    fields: ["title", "content"],
    storeFields: ["title", "content", "file"],
    searchOptions: {
      boost: { title: 2 },
      fuzzy: 0.2,
      prefix: true,
    },
  });

  const newStates = new Map<string, FileState>();

  for await (const { absPath, relPath } of walkMdFiles(dir, dir)) {
    const fileStat = await stat(absPath);
    const content = await readFile(absPath, "utf-8");

    const sections = splitSections(content, relPath);
    for (const section of sections) {
      newIndex.add(section);
    }

    newStates.set(relPath, { mtimeMs: fileStat.mtimeMs });
  }

  index = newIndex;
  fileStates = newStates;
  indexDir = dir;
}

export interface SearchResult {
  file: string;
  section: string;
  content: string;
  score: number;
}

/**
 * Searches memory files using full-text search with fuzzy matching.
 */
export async function searchMemory(
  dir: string,
  query: string
): Promise<{ results: SearchResult[]; total: number }> {
  if (await needsRebuild(dir)) {
    await buildIndex(dir);
  }

  const results = index!.search(query, {
    fuzzy: 0.2,
    prefix: true,
    boost: { title: 2 },
  });

  const maxResults = 10;
  const maxContentLength = 500;

  const formatted: SearchResult[] = results.slice(0, maxResults).map((r) => ({
    file: r.file as string,
    section: r.title as string,
    content:
      (r.content as string).length > maxContentLength
        ? (r.content as string).slice(0, maxContentLength) + "\u2026"
        : (r.content as string),
    score: Math.round(r.score * 100) / 100,
  }));

  return { results: formatted, total: results.length };
}

/**
 * Resets the index. For testing only.
 */
export function resetIndex(): void {
  index = null;
  fileStates = new Map();
  indexDir = null;
}
