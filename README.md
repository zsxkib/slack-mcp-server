# Slack MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for accessing Slack workspace data. Slack access is read-only — the server reads channels, messages, threads, and user information but never posts or modifies anything in your workspace. It also includes persistent local memory for cross-session context and built-in error diagnostics.

## Features

### Slack Tools

| Tool | Description | Auth Required |
|------|-------------|---------------|
| `list_channels` | List all accessible public channels with pagination | Bot or User |
| `get_channel_history` | Retrieve message history from a specific channel | Bot or User |
| `get_thread_replies` | Get all replies in a message thread (including parent) | Bot or User |
| `list_users` | List all workspace users with pagination | Bot or User |
| `get_user_profile` | Get detailed profile information for a specific user | Bot or User |
| `search_messages` | Search messages across all channels | User only |
| `refresh_credentials` | Manually trigger credential refresh | User only |

### Memory Tools

| Tool | Description | Requires |
|------|-------------|----------|
| `read_memory` | List memory files or read a specific file | `SLACK_MEMORY_DIR` |
| `search_memory` | Full-text fuzzy search across memory files | `SLACK_MEMORY_DIR` |
| `update_memory` | Append, replace, or create `.md` memory files | `SLACK_MEMORY_DIR` |

Memory tools give the AI persistent workspace knowledge across sessions. Set `SLACK_MEMORY_DIR` to a directory of `.md` files (e.g., people notes, project context, meeting summaries). Supports subdirectories and full-text search with fuzzy matching.

### Diagnostics Tools

| Tool | Description |
|------|-------------|
| `get_error_log` | Read recent errors with summary stats (error counts by code) |
| `clear_error_log` | Clear log entries after diagnosing and fixing issues |

All Slack API failures, refresh errors, and memory tool errors are automatically logged to `~/.slack-mcp-server/error.log` (JSONL format, auto-rotates at 1000 entries). This creates a feedback loop: errors accumulate, a future session reads them via `get_error_log`, fixes the root cause, then clears with `clear_error_log`.

## Installation

### Prerequisites

- Node.js 20+
- pnpm (or npm/yarn)
- A Slack workspace with appropriate access

### Setup

```bash
# Clone the repository
git clone https://github.com/zsxkib/slack-mcp-server.git
cd slack-mcp-server

# Install dependencies
pnpm install

# Build the project
pnpm run build
```

## Authentication

The server supports two authentication methods:

### Option 1: Bot Token (Recommended)

Use a standard Slack Bot User OAuth token for most use cases.

1. Create a Slack App at [api.slack.com/apps](https://api.slack.com/apps)
2. Add the following Bot Token Scopes under **OAuth & Permissions**:
   - `channels:read` - List public channels
   - `channels:history` - Read channel messages
   - `users:read` - List workspace users
   - `users.profile:read` - Read user profiles
3. Install the app to your workspace
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

```bash
export SLACK_BOT_TOKEN=xoxb-your-token-here
```

### Option 2: User Token (Unofficial - Required for Search)

Use a user token to enable the `search_messages` tool. This method uses browser session credentials.

> **Warning:** This authentication method uses unofficial session credentials extracted from your browser. It may violate Slack's Terms of Service. Session tokens expire and require manual re-extraction. Use at your own risk and only with workspaces where you have appropriate authorization.

1. Open your Slack workspace in a browser
2. Open Developer Tools (F12) → Application → Cookies
3. Find and copy the `d` cookie value (starts with `xoxd-`)
4. In the Network tab, find any API request and copy the token from the Authorization header (starts with `xoxc-`)

```bash
export SLACK_USER_TOKEN=xoxc-your-token-here
export SLACK_COOKIE_D=xoxd-your-cookie-here
```

> **Note:** If both bot token and user token are configured, the bot token takes precedence.

### Token Auto-Refresh (User Token Only)

User tokens expire periodically. The server can automatically refresh credentials to maintain uninterrupted access.

**Required for auto-refresh:**

```bash
export SLACK_USER_TOKEN=xoxc-your-token-here
export SLACK_COOKIE_D=xoxd-your-cookie-here
export SLACK_WORKSPACE=your-workspace-name  # e.g., "mycompany" from mycompany.slack.com
```

**Optional configuration:**

```bash
# Credential storage location (default: ~/.slack-mcp-server/credentials.json)
export SLACK_CREDENTIALS_PATH=/custom/path/credentials.json

# Refresh interval in days (default: 7)
export SLACK_REFRESH_INTERVAL_DAYS=7

# Enable/disable auto-refresh (default: true)
export SLACK_REFRESH_ENABLED=true
```

**How it works:**

1. On startup, credentials are loaded from storage (if available) or saved from environment variables
2. Every hour, the system checks if refresh is due based on the configured interval
3. When due, both xoxc token and d cookie are refreshed via a request to your workspace
4. New credentials are persisted to the credentials file with secure permissions (0600)
5. If refresh fails, retries occur with exponential backoff (max 3 attempts)
6. You can also manually trigger refresh using the `refresh_credentials` tool

## Usage

### Running the Server

```bash
# With bot token
SLACK_BOT_TOKEN=xoxb-... pnpm start

# With user token (enables search)
SLACK_USER_TOKEN=xoxc-... SLACK_COOKIE_D=xoxd-... pnpm start
```

### Claude Code Configuration

Add this MCP server to Claude Code:

```bash
# With bot token
claude mcp add slack -- node /absolute/path/to/slack-mcp-server/build/index.js \
  -e SLACK_BOT_TOKEN=xoxb-your-token-here

# With user token (enables search)
claude mcp add slack -- node /absolute/path/to/slack-mcp-server/build/index.js \
  -e SLACK_USER_TOKEN=xoxc-your-token-here \
  -e SLACK_COOKIE_D=xoxd-your-cookie-here
```

To verify the server is configured:

```bash
claude mcp list
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SLACK_BOT_TOKEN` | One of bot/user | — | Bot User OAuth Token (`xoxb-...`) |
| `SLACK_USER_TOKEN` | One of bot/user | — | User session token (`xoxc-...`) |
| `SLACK_COOKIE_D` | With user token | — | Session cookie (`xoxd-...`) |
| `SLACK_WORKSPACE` | For auto-refresh | — | Workspace name (e.g., `mycompany`) |
| `SLACK_MEMORY_DIR` | For memory tools | — | Path to directory of `.md` memory files |
| `SLACK_CREDENTIALS_PATH` | No | `~/.slack-mcp-server/credentials.json` | Credential storage location |
| `SLACK_ERROR_LOG_PATH` | No | `~/.slack-mcp-server/error.log` | Error log location |
| `SLACK_REFRESH_INTERVAL_DAYS` | No | `7` | Days between auto-refreshes |
| `SLACK_REFRESH_ENABLED` | No | `true` | Enable/disable auto-refresh |

## Tool Reference

### list_channels

List all accessible public channels in the workspace.

**Parameters:**
- `limit` (optional): Maximum channels to return (1-1000, default: 100)
- `cursor` (optional): Pagination cursor from previous response
- `exclude_archived` (optional): Exclude archived channels (default: true)

### get_channel_history

Retrieve message history from a specific channel. Accepts channel ID or name.

**Parameters:**
- `channel_id` (required): Channel ID (e.g., `C1234567890`) or name (e.g., `general`)
- `limit` (optional): Maximum messages to return (1-1000, default: 50)
- `cursor` (optional): Pagination cursor
- `oldest` (optional): Only messages after this timestamp
- `latest` (optional): Only messages before this timestamp

### get_thread_replies

Retrieve all replies in a message thread. Pass the `threadId` from a message (not the message `id`).

**Parameters:**
- `channel_id` (required): Channel ID or name containing the thread
- `thread_ts` (required): The `threadId` from the parent message
- `limit` (optional): Maximum replies to return (1-1000, default: 50)
- `cursor` (optional): Pagination cursor

### list_users

List all users in the workspace.

**Parameters:**
- `limit` (optional): Maximum users to return (1-1000, default: 200)
- `cursor` (optional): Pagination cursor

### get_user_profile

Get detailed profile information for a specific user.

**Parameters:**
- `user_id` (required): User ID (e.g., `U1234567890`)

### search_messages

Search for messages across all accessible channels. **Requires user token authentication.**

**Parameters:**
- `query` (required): Search query (supports Slack modifiers: `from:`, `in:`, `before:`, `after:`)
- `sort` (optional): Sort by `score` or `timestamp` (default: score)
- `sort_dir` (optional): Sort direction `asc` or `desc` (default: desc)
- `count` (optional): Results per page (1-100, default: 20)
- `page` (optional): Page number (default: 1)

### refresh_credentials

Manually trigger a refresh of Slack user credentials. **Requires user token authentication with `SLACK_WORKSPACE` configured.**

**Parameters:** None

**Returns:**
- On success: `{ success: true, message, refreshedAt, totalRefreshes }`
- On failure: `{ success: false, error: { code, message, retryable } }`

**Error codes:**
- `REFRESH_NOT_AVAILABLE` - Bot token auth or workspace not configured
- `REFRESH_IN_PROGRESS` - Another refresh is already running
- `SESSION_REVOKED` - Credentials invalidated, manual re-auth required
- `NETWORK_ERROR` - Connectivity issue (retryable)

### read_memory

Read persistent workspace memory. **Requires `SLACK_MEMORY_DIR`.**

**Parameters:**
- `path` (optional): File path relative to memory dir (e.g., `people.md`). Omit to list all files.

### search_memory

Full-text search across workspace memory files. **Requires `SLACK_MEMORY_DIR`.**

**Parameters:**
- `query` (required): Search query (e.g., `onboarding`, `API keys`, `deploy process`)

### update_memory

Update workspace memory files. **Requires `SLACK_MEMORY_DIR`.**

**Parameters:**
- `path` (required): File path relative to memory dir (must end in `.md`)
- `content` (required): Content to write
- `mode` (optional): `append` (default), `replace`, or `create` (fails if file exists)

### get_error_log

Read recent errors from the server error log.

**Parameters:**
- `limit` (optional): Maximum entries to return (1-500, default: 50)

**Returns:** `{ total, codeCounts, entries }` — entries are newest-first with `ts`, `level`, `component`, `code`, `message`, and optional `tool`, `context`, `retryable` fields.

### clear_error_log

Clear error log entries after diagnosing and fixing issues.

**Parameters:**
- `before` (optional): ISO timestamp — clear only entries before this time. Omit to clear all.

**Returns:** `{ cleared, remaining }`

## Architecture

```
src/
  index.ts              Entry point — imports tools, starts refresh scheduler
  server.ts             McpServer singleton
  tools/                Tool registrations (one file per domain)
    channels.ts         list_channels
    messages.ts         get_channel_history, get_thread_replies
    users.ts            list_users, get_user_profile
    search.ts           search_messages
    refresh.ts          refresh_credentials
    memory.ts           read_memory, search_memory, update_memory
    error-log.ts        get_error_log, clear_error_log
  slack/
    client.ts           Slack WebClient wrapper, auth initialization
    types.ts            TypeScript types for all domain models
  refresh/
    manager.ts          Credential refresh with retry + exponential backoff
    scheduler.ts        Hourly auto-refresh scheduler
    storage.ts          Credential persistence with secure file permissions
  memory/
    index.ts            Full-text search engine (minisearch)
  config/
    memory.ts           Memory directory configuration
  cache/
    channel-cache.ts    Channel ID → name resolution cache
    user-cache.ts       User ID → display name resolution cache
  utils/
    errors.ts           Error mapping, formatting, credential masking
    error-log.ts        Append-only error log with JSONL + rotation
    format/             Message formatting pipeline
tests/
  unit/                 Unit tests with mocking
  integration/          Integration tests
```

## Development

```bash
# Build
pnpm build

# Run tests
pnpm test

# Type check
pnpm lint

# Watch mode (rebuild on changes)
pnpm dev
```

## Disclaimer

This project is not affiliated with Slack Technologies, LLC.

User token authentication is unofficial and may not comply with Slack's Terms of Service. Bot token authentication is the recommended approach.
