import { resolve } from "node:path";

/**
 * Returns the memory directory path from env var, or null if not configured.
 */
export function getMemoryDir(): string | null {
  const dir = process.env.SLACK_MEMORY_DIR;
  if (!dir || dir.trim() === "") return null;
  return resolve(dir);
}

/**
 * Returns true if memory tools should be registered.
 */
export function isMemoryAvailable(): boolean {
  return getMemoryDir() !== null;
}
