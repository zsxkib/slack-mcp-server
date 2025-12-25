# Data Model: Slack MCP Server (Read-Only)

**Date**: 2025-12-25
**Branch**: `001-slack-mcp-read-only`

## Overview

This document defines the data entities used by the Slack MCP server. All entities are read-only projections of Slack API responses—no persistence layer required.

---

## Core Entities

### Channel

Represents a Slack channel (public) that users can retrieve messages from.

| Field | Type | Source | Description |
|-------|------|--------|-------------|
| `id` | `string` | `id` | Unique channel identifier (e.g., `C1234567890`) |
| `name` | `string` | `name` | Channel name without `#` prefix |
| `topic` | `string \| null` | `topic.value` | Current channel topic |
| `purpose` | `string \| null` | `purpose.value` | Channel purpose/description |
| `memberCount` | `number` | `num_members` | Number of members in channel |
| `isArchived` | `boolean` | `is_archived` | Whether channel is archived |
| `created` | `number` | `created` | Unix timestamp of creation |

**Slack API Source**: `conversations.list`, `conversations.info`

**TypeScript Definition**:
```typescript
interface Channel {
  id: string;
  name: string;
  topic: string | null;
  purpose: string | null;
  memberCount: number;
  isArchived: boolean;
  created: number;
}
```

---

### Message

A single message in a channel.

| Field | Type | Source | Description |
|-------|------|--------|-------------|
| `ts` | `string` | `ts` | Message timestamp (unique ID within channel) |
| `userId` | `string` | `user` | Author's user ID |
| `text` | `string` | `text` | Message content (may include Slack markup) |
| `threadTs` | `string \| null` | `thread_ts` | Parent thread timestamp (if reply) |
| `replyCount` | `number \| null` | `reply_count` | Number of replies (if thread parent) |
| `reactions` | `Reaction[]` | `reactions` | Emoji reactions on message |

**Slack API Source**: `conversations.history`, `conversations.replies`

**TypeScript Definition**:
```typescript
interface Message {
  ts: string;
  userId: string;
  text: string;
  threadTs: string | null;
  replyCount: number | null;
  reactions: Reaction[];
}

interface Reaction {
  name: string;      // Emoji name without colons
  count: number;     // Number of users who reacted
  users: string[];   // User IDs who reacted
}
```

---

### User

A workspace member.

| Field | Type | Source | Description |
|-------|------|--------|-------------|
| `id` | `string` | `id` | Unique user identifier (e.g., `U1234567890`) |
| `name` | `string` | `name` | Username |
| `realName` | `string \| null` | `real_name` | Full name |
| `displayName` | `string \| null` | `profile.display_name` | Display name |
| `isBot` | `boolean` | `is_bot` | Whether user is a bot |
| `isAdmin` | `boolean` | `is_admin` | Whether user is workspace admin |
| `deleted` | `boolean` | `deleted` | Whether user is deactivated |

**Slack API Source**: `users.list`

**TypeScript Definition**:
```typescript
interface User {
  id: string;
  name: string;
  realName: string | null;
  displayName: string | null;
  isBot: boolean;
  isAdmin: boolean;
  deleted: boolean;
}
```

---

### UserProfile

Detailed user profile information.

| Field | Type | Source | Description |
|-------|------|--------|-------------|
| `displayName` | `string` | `display_name` | Display name |
| `realName` | `string` | `real_name` | Full name |
| `title` | `string \| null` | `title` | Job title |
| `email` | `string \| null` | `email` | Email address (if visible) |
| `phone` | `string \| null` | `phone` | Phone number (if visible) |
| `statusText` | `string \| null` | `status_text` | Current status message |
| `statusEmoji` | `string \| null` | `status_emoji` | Current status emoji |
| `image72` | `string \| null` | `image_72` | 72x72 avatar URL |

**Slack API Source**: `users.profile.get`

**TypeScript Definition**:
```typescript
interface UserProfile {
  displayName: string;
  realName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  statusText: string | null;
  statusEmoji: string | null;
  image72: string | null;
}
```

---

### SearchResult

A message matching a search query.

| Field | Type | Source | Description |
|-------|------|--------|-------------|
| `ts` | `string` | `ts` | Message timestamp |
| `text` | `string` | `text` | Message content |
| `userId` | `string` | `user` | Author's user ID |
| `username` | `string` | `username` | Author's username |
| `channelId` | `string` | `channel.id` | Source channel ID |
| `channelName` | `string` | `channel.name` | Source channel name |
| `permalink` | `string` | `permalink` | Direct link to message |

**Slack API Source**: `search.messages`

**TypeScript Definition**:
```typescript
interface SearchResult {
  ts: string;
  text: string;
  userId: string;
  username: string;
  channelId: string;
  channelName: string;
  permalink: string;
}
```

---

## Pagination Types

### CursorPagination

Used by most Slack API methods.

```typescript
interface CursorPaginationParams {
  limit?: number;    // Max items per page
  cursor?: string;   // Cursor for next page (empty for first)
}

interface CursorPaginationResult<T> {
  items: T[];
  nextCursor: string | null;  // null if no more pages
  hasMore: boolean;
}
```

### PagePagination

Used by `search.messages` only.

```typescript
interface PagePaginationParams {
  count?: number;    // Items per page (max 100)
  page?: number;     // Page number (1-indexed)
}

interface PagePaginationResult<T> {
  items: T[];
  total: number;     // Total matches
  page: number;      // Current page
  pageCount: number; // Total pages
}
```

---

## Error Types

```typescript
interface SlackMcpError {
  code: string;        // Slack error code
  message: string;     // Human-readable message
  retryable: boolean;  // Whether request can be retried
  retryAfter?: number; // Seconds to wait (for rate limits)
}

// Common error codes
type SlackErrorCode =
  | 'rate_limited'       // Too many requests
  | 'invalid_auth'       // Bad token
  | 'missing_scope'      // Insufficient permissions
  | 'channel_not_found'  // Invalid channel ID
  | 'user_not_found'     // Invalid user ID
  | 'not_in_channel'     // Bot not in channel
  | 'thread_not_found';  // Invalid thread timestamp
```

---

## Relationships

```text
Channel 1──n Message    (channel contains messages)
Message 1──n Message    (parent contains replies via threadTs)
Message n──1 User       (message authored by user)
User    1──1 UserProfile (user has one profile)
```

---

## Validation Rules

| Entity | Field | Rule |
|--------|-------|------|
| Channel | `id` | Must match pattern `^C[A-Z0-9]+$` |
| User | `id` | Must match pattern `^U[A-Z0-9]+$` |
| Message | `ts` | Must match pattern `^\d+\.\d+$` |
| All | `limit` | Range: 1-1000 (default varies by endpoint) |

---

## Notes

- All timestamps are Slack's string-based format (e.g., `"1512085950.000216"`)
- Text fields may contain Slack markup (mentions, links, emoji codes)
- User IDs in messages need resolution via `users.list` or `users.profile.get`
- No state transitions—all entities are immutable snapshots from Slack API
