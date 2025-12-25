# MCP Tool Contracts: Slack MCP Server

**Date**: 2025-12-25
**Protocol**: Model Context Protocol (MCP)
**Transport**: stdio

---

## Tool Summary

| Tool | Priority | Description |
|------|----------|-------------|
| `slack_list_channels` | P1 | List public channels in workspace |
| `slack_get_channel_history` | P1 | Get message history from a channel |
| `slack_get_thread_replies` | P1 | Get replies in a message thread |
| `slack_list_users` | P2 | List workspace users |
| `slack_get_user_profile` | P2 | Get detailed user profile |
| `slack_search_messages` | P3 | Search messages across channels |

---

## Tool Definitions

### slack_list_channels

**Description**: List all public channels accessible to the bot in the Slack workspace.

**Input Schema** (Zod):
```typescript
{
  limit: z.number().min(1).max(1000).optional()
    .describe("Maximum number of channels to return (default: 100)"),
  cursor: z.string().optional()
    .describe("Pagination cursor from previous response"),
  exclude_archived: z.boolean().optional()
    .describe("Exclude archived channels (default: true)")
}
```

**Output**: JSON with channel list and pagination
```json
{
  "channels": [
    {
      "id": "C1234567890",
      "name": "general",
      "topic": "Company-wide announcements",
      "purpose": "General discussion",
      "memberCount": 42,
      "isArchived": false
    }
  ],
  "nextCursor": "dGVhbTpDMDYxRkE1UEI=",
  "hasMore": true
}
```

**Errors**:
- `invalid_auth`: Invalid Slack token
- `missing_scope`: Token lacks `channels:read` scope

---

### slack_get_channel_history

**Description**: Retrieve message history from a specific channel.

**Input Schema** (Zod):
```typescript
{
  channel_id: z.string()
    .describe("Channel ID (e.g., C1234567890)"),
  limit: z.number().min(1).max(1000).optional()
    .describe("Maximum messages to return (default: 50)"),
  cursor: z.string().optional()
    .describe("Pagination cursor from previous response"),
  oldest: z.string().optional()
    .describe("Only messages after this timestamp"),
  latest: z.string().optional()
    .describe("Only messages before this timestamp")
}
```

**Output**: JSON with message list and pagination
```json
{
  "messages": [
    {
      "ts": "1512085950.000216",
      "userId": "U1234567890",
      "text": "Hello world!",
      "threadTs": null,
      "replyCount": 3,
      "reactions": [
        { "name": "thumbsup", "count": 2 }
      ]
    }
  ],
  "nextCursor": "bmV4dF90czox...",
  "hasMore": true
}
```

**Errors**:
- `channel_not_found`: Invalid channel ID
- `not_in_channel`: Bot not a member of channel
- `missing_scope`: Token lacks `channels:history` scope

---

### slack_get_thread_replies

**Description**: Retrieve all replies in a message thread.

**Input Schema** (Zod):
```typescript
{
  channel_id: z.string()
    .describe("Channel ID containing the thread"),
  thread_ts: z.string()
    .describe("Timestamp of the parent message"),
  limit: z.number().min(1).max(1000).optional()
    .describe("Maximum replies to return (default: 50)"),
  cursor: z.string().optional()
    .describe("Pagination cursor from previous response")
}
```

**Output**: JSON with thread messages (parent + replies)
```json
{
  "messages": [
    {
      "ts": "1512085950.000216",
      "userId": "U1234567890",
      "text": "Parent message",
      "threadTs": "1512085950.000216",
      "replyCount": 2,
      "reactions": []
    },
    {
      "ts": "1512104434.000490",
      "userId": "U0987654321",
      "text": "Reply message",
      "threadTs": "1512085950.000216",
      "replyCount": null,
      "reactions": []
    }
  ],
  "nextCursor": null,
  "hasMore": false
}
```

**Errors**:
- `channel_not_found`: Invalid channel ID
- `thread_not_found`: Invalid thread timestamp
- `missing_scope`: Token lacks `channels:history` scope

---

### slack_list_users

**Description**: List all users in the Slack workspace.

**Input Schema** (Zod):
```typescript
{
  limit: z.number().min(1).max(1000).optional()
    .describe("Maximum users to return (default: 200)"),
  cursor: z.string().optional()
    .describe("Pagination cursor from previous response")
}
```

**Output**: JSON with user list and pagination
```json
{
  "users": [
    {
      "id": "U1234567890",
      "name": "johndoe",
      "realName": "John Doe",
      "displayName": "John",
      "isBot": false,
      "isAdmin": false,
      "deleted": false
    }
  ],
  "nextCursor": "dXNlcjpVMDYx...",
  "hasMore": true
}
```

**Errors**:
- `invalid_auth`: Invalid Slack token
- `missing_scope`: Token lacks `users:read` scope

---

### slack_get_user_profile

**Description**: Get detailed profile information for a specific user.

**Input Schema** (Zod):
```typescript
{
  user_id: z.string()
    .describe("User ID (e.g., U1234567890)")
}
```

**Output**: JSON with user profile
```json
{
  "profile": {
    "displayName": "John",
    "realName": "John Doe",
    "title": "Software Engineer",
    "email": "john@example.com",
    "phone": "+1234567890",
    "statusText": "In a meeting",
    "statusEmoji": ":calendar:",
    "image72": "https://avatars.slack-edge.com/..."
  }
}
```

**Errors**:
- `user_not_found`: Invalid user ID
- `missing_scope`: Token lacks `users.profile:read` scope

---

### slack_search_messages

**Description**: Search for messages across all accessible channels.

**Input Schema** (Zod):
```typescript
{
  query: z.string()
    .describe("Search query (supports Slack search modifiers: from:, in:, before:, after:)"),
  sort: z.enum(["score", "timestamp"]).optional()
    .describe("Sort order (default: score)"),
  sort_dir: z.enum(["asc", "desc"]).optional()
    .describe("Sort direction (default: desc)"),
  count: z.number().min(1).max(100).optional()
    .describe("Results per page (default: 20)"),
  page: z.number().min(1).optional()
    .describe("Page number (default: 1)")
}
```

**Output**: JSON with search results and pagination
```json
{
  "results": [
    {
      "ts": "1512085950.000216",
      "text": "Message containing search term",
      "userId": "U1234567890",
      "username": "johndoe",
      "channelId": "C1234567890",
      "channelName": "general",
      "permalink": "https://team.slack.com/archives/..."
    }
  ],
  "total": 42,
  "page": 1,
  "pageCount": 3
}
```

**Errors**:
- `invalid_auth`: Invalid Slack token
- `missing_scope`: Token lacks `search:read` scope

---

## Common Error Response Format

All tools return errors in MCP format:
```json
{
  "content": [
    {
      "type": "text",
      "text": "Error: channel_not_found - Channel C999 not found or not accessible"
    }
  ],
  "isError": true
}
```

## Rate Limit Handling

When Slack returns `rate_limited`, tool response includes retry information:
```json
{
  "content": [
    {
      "type": "text",
      "text": "Rate limited by Slack API. Please retry after 30 seconds."
    }
  ],
  "isError": true
}
```

---

## Environment Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_BOT_TOKEN` | Yes | Slack Bot User OAuth Token (xoxb-...) |

---

## Required OAuth Scopes

```
channels:read        # slack_list_channels
channels:history     # slack_get_channel_history, slack_get_thread_replies
users:read          # slack_list_users
users.profile:read  # slack_get_user_profile
search:read         # slack_search_messages
```
