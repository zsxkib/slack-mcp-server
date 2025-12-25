# Research: Slack MCP Server (Read-Only)

**Date**: 2025-12-25
**Branch**: `001-slack-mcp-read-only`

## Resolved Clarifications

### Language/Version

**Decision**: TypeScript with Node.js 20+

**Rationale**:
- MCP ecosystem predominantly uses TypeScript (most reference servers, examples, tutorials)
- `@slack/web-api` is extremely mature with comprehensive TypeScript definitions
- `npx` enables zero-install distribution for end users
- TypeScript + Zod provides compile-time + runtime type safety
- Better JSON handling ergonomics for Slack API responses and MCP protocol

**Alternatives Considered**:
- Python 3.11+ with `mcp` SDK - Rejected: Less common in MCP ecosystem, decorator-based API adds implicit magic

### Testing Framework

**Decision**: vitest

**Rationale**:
- TypeScript-native, no additional configuration needed
- Fast execution with native ESM support
- Compatible with Node.js 20+ module system
- Excellent mock support for testing Slack API client

**Alternatives Considered**:
- jest - Rejected: Heavier setup for ESM/TypeScript
- node:test - Rejected: Less ergonomic for mocking

---

## MCP SDK Best Practices

### Package

- **SDK**: `@modelcontextprotocol/sdk`
- **Installation**: `npm install @modelcontextprotocol/sdk zod@3`

### Server Structure

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "slack-mcp-server",
  version: "1.0.0",
});

// Register tool with Zod schema
server.registerTool(
  "tool_name",
  {
    description: "Tool description",
    inputSchema: {
      param: z.string().describe("Parameter description"),
    },
  },
  async ({ param }) => {
    return {
      content: [{ type: "text", text: "result" }],
    };
  }
);

// Connect transport
const transport = new StdioServerTransport();
await server.connect(transport);
```

### Critical Rules

1. **Never write to stdout** - Use `console.error()` for all logging (stdout reserved for JSON-RPC)
2. **Tool results** must return `{ content: [{ type: "text", text: string }] }`
3. **Error responses** should set `isError: true` in result

### Transport Options

| Transport | Use Case |
|-----------|----------|
| stdio | Local integration (Claude Desktop, CLI) - **DEFAULT** |
| HTTP/SSE | Remote server deployments |

---

## Slack API Reference

### Required OAuth Scopes

| Scope | Purpose |
|-------|---------|
| `channels:read` | List public channels |
| `channels:history` | Read message history |
| `users:read` | List workspace users |
| `users.profile:read` | Read user profiles |
| `search:read` | Search messages |

### API Methods

| Method | Rate Tier | Pagination | Key Parameters |
|--------|-----------|------------|----------------|
| `conversations.list` | Tier 2 (~20/min) | Cursor | `limit`, `cursor`, `exclude_archived` |
| `conversations.history` | Tier 3 (~50/min) | Cursor | `channel`, `limit`, `cursor`, `oldest`, `latest` |
| `conversations.replies` | Tier 3 (~50/min) | Cursor | `channel`, `ts`, `limit`, `cursor` |
| `users.list` | Tier 2 (~20/min) | Cursor | `limit`, `cursor` |
| `users.profile.get` | Tier 4 (~100/min) | N/A | `user` |
| `search.messages` | Tier 2 (~20/min) | Page-based | `query`, `sort`, `count`, `page` |

### Rate Limit Handling

```typescript
// Response when rate limited
{
  "ok": false,
  "error": "rate_limited",
  "retry_after": 42  // seconds
}
// HTTP Status: 429

// Best practice: Exponential backoff with retry_after
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error.code === 'slack_webapi_rate_limited') {
        const delay = error.retryAfter || Math.pow(2, i) * 1000;
        await new Promise(r => setTimeout(r, delay * 1000));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}
```

### Error Categories

| Error Type | Retryable | Action |
|------------|-----------|--------|
| `rate_limited` | Yes | Wait `retry_after` seconds |
| `internal_error` | Yes | Exponential backoff |
| `invalid_auth` | No | Surface to user |
| `missing_scope` | No | Document required scope |
| `channel_not_found` | No | Return clear error |
| `not_in_channel` | No | Return clear error |

### Pagination Pattern (Cursor-based)

```typescript
async function fetchAllPages<T>(
  fetchFn: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string }>
): Promise<T[]> {
  const results: T[] = [];
  let cursor: string | undefined;

  do {
    const response = await fetchFn(cursor);
    results.push(...response.items);
    cursor = response.nextCursor;
  } while (cursor);

  return results;
}
```

---

## Tool-to-API Mapping

| MCP Tool | Slack Method | Priority |
|----------|--------------|----------|
| `slack_list_channels` | `conversations.list` | P1 |
| `slack_get_channel_history` | `conversations.history` | P1 |
| `slack_get_thread_replies` | `conversations.replies` | P1 |
| `slack_list_users` | `users.list` | P2 |
| `slack_get_user_profile` | `users.profile.get` | P2 |
| `slack_search_messages` | `search.messages` | P3 |

---

## Dependencies Summary

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@slack/web-api": "^7.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "vitest": "^2.0.0"
  }
}
```

---

## Open Questions (None)

All clarifications resolved. Ready for Phase 1 design.
