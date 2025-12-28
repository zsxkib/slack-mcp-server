import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { StoredCredentials } from "../slack/types.js";
import { RefreshError } from "../utils/errors.js";

/**
 * Zod schema for validating stored credentials
 */
export const StoredCredentialsSchema = z.object({
  version: z.literal(1),
  credentials: z.object({
    token: z.string().refine((val) => val.startsWith("xoxc-"), {
      message: "Token must start with 'xoxc-'",
    }),
    cookie: z.string().refine((val) => val.startsWith("xoxd-"), {
      message: "Cookie must start with 'xoxd-'",
    }),
    workspace: z.string().min(1, "Workspace must be non-empty"),
  }),
  metadata: z.object({
    lastRefreshed: z.string().datetime(),
    refreshCount: z.number().int().nonnegative(),
    source: z.enum(["initial", "auto-refresh", "manual-refresh"]),
  }),
});

/**
 * Default credentials file path
 */
const DEFAULT_CREDENTIALS_PATH = path.join(
  os.homedir(),
  ".slack-mcp-server",
  "credentials.json"
);

/**
 * Get the credentials file path from environment or default
 */
export function getCredentialsPath(): string {
  return process.env.SLACK_CREDENTIALS_PATH ?? DEFAULT_CREDENTIALS_PATH;
}

/**
 * Check if stored credentials exist
 */
export function credentialsExist(): boolean {
  const credentialsPath = getCredentialsPath();
  return fs.existsSync(credentialsPath);
}

/**
 * Load stored credentials from disk
 * @throws RefreshError if file doesn't exist, is corrupted, or validation fails
 */
export function loadCredentials(): StoredCredentials {
  const credentialsPath = getCredentialsPath();

  if (!fs.existsSync(credentialsPath)) {
    throw new RefreshError(
      "STORAGE_ERROR",
      `Credentials file not found: ${credentialsPath}`
    );
  }

  try {
    const content = fs.readFileSync(credentialsPath, "utf-8");
    const data = JSON.parse(content);
    const result = StoredCredentialsSchema.safeParse(data);

    if (!result.success) {
      throw new RefreshError(
        "STORAGE_ERROR",
        `Invalid credentials file format: ${result.error.message}`
      );
    }

    return result.data;
  } catch (error) {
    if (error instanceof RefreshError) {
      throw error;
    }
    if (error instanceof SyntaxError) {
      throw new RefreshError(
        "STORAGE_ERROR",
        `Credentials file is corrupted: ${error.message}`
      );
    }
    throw new RefreshError(
      "STORAGE_ERROR",
      `Failed to load credentials: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Save credentials to disk with atomic write and secure permissions
 * Uses write-to-temp-then-rename pattern for atomicity
 */
export function saveCredentials(credentials: StoredCredentials): void {
  const credentialsPath = getCredentialsPath();
  const dir = path.dirname(credentialsPath);

  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  // Validate before saving
  const result = StoredCredentialsSchema.safeParse(credentials);
  if (!result.success) {
    throw new RefreshError(
      "STORAGE_ERROR",
      `Cannot save invalid credentials: ${result.error.message}`
    );
  }

  const tempPath = `${credentialsPath}.tmp.${process.pid}`;

  try {
    // Write to temp file
    fs.writeFileSync(tempPath, JSON.stringify(credentials, null, 2), {
      encoding: "utf-8",
      mode: 0o600, // Owner read/write only
    });

    // Atomic rename
    fs.renameSync(tempPath, credentialsPath);

    // Ensure correct permissions on final file (in case it existed before)
    fs.chmodSync(credentialsPath, 0o600);
  } catch (error) {
    // Clean up temp file on failure
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // Ignore cleanup errors
    }

    throw new RefreshError(
      "STORAGE_ERROR",
      `Failed to save credentials: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Create initial stored credentials from environment variables
 */
export function createInitialCredentials(
  token: string,
  cookie: string,
  workspace: string
): StoredCredentials {
  return {
    version: 1,
    credentials: {
      token,
      cookie,
      workspace,
    },
    metadata: {
      lastRefreshed: new Date().toISOString(),
      refreshCount: 0,
      source: "initial",
    },
  };
}
