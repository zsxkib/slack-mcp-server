# slack-mcp-server

MCP server for read-only Slack workspace access with persistent memory and error diagnostics.

## Commands

```bash
pnpm build          # TypeScript → build/
pnpm test           # vitest run (294 tests)
pnpm lint           # tsc --noEmit
pnpm dev            # tsc --watch
```

## Architecture

```
src/
  index.ts              Entry point — imports all tools, starts refresh scheduler
  server.ts             McpServer singleton
  tools/                One file per domain, registers tools via server.registerTool()
    channels.ts         list_channels
    messages.ts         get_channel_history, get_thread_replies
    users.ts            list_users, get_user_profile
    search.ts           search_messages (user token only)
    refresh.ts          refresh_credentials
    memory.ts           read_memory, search_memory, update_memory
    error-log.ts        get_error_log, clear_error_log
  slack/
    client.ts           Slack WebClient wrapper, auth initialization
    types.ts            All TypeScript types
  refresh/
    manager.ts          Credential refresh with retry + exponential backoff
    scheduler.ts        Hourly auto-refresh scheduler
    storage.ts          Credential persistence (secure file permissions)
  memory/
    index.ts            Full-text search engine (minisearch)
  config/
    memory.ts           Memory directory configuration
  cache/
    channel-cache.ts    Channel ID → name resolution
    user-cache.ts       User ID → display name resolution
  utils/
    errors.ts           Error mapping + formatErrorForMcp (auto-logs errors)
    error-log.ts        Append-only JSONL error log with rotation
    format/             Message formatting pipeline (timestamps, markup, reactions, clean)
tests/
  unit/                 Unit tests with mocking
  integration/          Integration tests
```

## Key Patterns

- **Tool registration**: Each `src/tools/*.ts` file is a side-effect import in `index.ts`. It imports the server singleton and calls `server.registerTool(name, config, handler)`.
- **Error handling**: Tool handlers catch errors via `mapSlackError()` → `formatErrorForMcp()`. The latter auto-logs to `~/.slack-mcp-server/error.log`.
- **Auth**: Bot token (`xoxb-`) or user token (`xoxc-` + `xoxd-` cookie). Bot takes precedence if both set.
- **Memory**: Enabled by `SLACK_MEMORY_DIR` env var. Only `.md` files. Supports subdirectories. Full-text fuzzy search via minisearch.
- **Error log**: JSONL at `~/.slack-mcp-server/error.log`. Auto-rotates at 1000 lines (trims to 500). All sync I/O.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `SLACK_BOT_TOKEN` | Bot OAuth token (`xoxb-...`) |
| `SLACK_USER_TOKEN` | User session token (`xoxc-...`) |
| `SLACK_COOKIE_D` | Session cookie (`xoxd-...`) |
| `SLACK_WORKSPACE` | Workspace name for auto-refresh |
| `SLACK_MEMORY_DIR` | Directory of `.md` memory files |
| `SLACK_CREDENTIALS_PATH` | Override credential storage path |
| `SLACK_ERROR_LOG_PATH` | Override error log path |
| `SLACK_REFRESH_INTERVAL_DAYS` | Days between auto-refreshes (default: 7) |
| `SLACK_REFRESH_ENABLED` | Enable/disable auto-refresh (default: true) |

## Critical Rules

- **NEVER use `console.log()` anywhere in `src/`**. This server uses MCP stdio transport — stdout is reserved exclusively for JSON-RPC frames. Any stray stdout write corrupts the protocol and breaks the handshake. Use `console.error()` for all logging (writes to stderr, which is safe).
- **Memory paths**: `validatePath()` checks both lexical traversal and symlink escape via `realpath()`. Always use it before any filesystem read/write in memory tools.
- **Error logging should never crash**: All `logError()` calls are wrapped in try/catch internally. Logging failures are silently ignored.

## Code Style

- TypeScript strict mode, ES2022 target, NodeNext modules
- Zod for input/output schema validation
- All tool handlers return `{ content: [{ type: "text", text }], structuredContent?, isError? }`
- Tests use vitest with `vi.mock()` for module mocking, temp directories for filesystem tests
- All logging via `console.error` (stderr only) — never `console.log`
- Error log: `appendFileSync` to JSONL file, never stdout
