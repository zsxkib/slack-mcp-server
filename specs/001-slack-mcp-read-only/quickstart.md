# Quickstart: Slack MCP Server

## Prerequisites

- Node.js 20+
- A Slack workspace with admin access
- Claude Desktop or another MCP client

## 1. Create Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Name: `MCP Slack Reader`, Workspace: Select your workspace
4. Under **OAuth & Permissions**, add these Bot Token Scopes:
   - `channels:read`
   - `channels:history`
   - `users:read`
   - `users.profile:read`
   - `search:read`
5. Click **Install to Workspace** and authorize
6. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

## 2. Install & Run

```bash
# Clone and install
git clone <repo-url> slack-mcp-server
cd slack-mcp-server
npm install

# Set token
export SLACK_BOT_TOKEN=xoxb-your-token-here

# Run server (stdio mode)
npm start
```

## 3. Configure Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "slack": {
      "command": "node",
      "args": ["/path/to/slack-mcp-server/build/index.js"],
      "env": {
        "SLACK_BOT_TOKEN": "xoxb-your-token-here"
      }
    }
  }
}
```

Restart Claude Desktop.

## 4. Test Tools

In Claude Desktop, try:

> "List the channels in my Slack workspace"

> "Show me the last 10 messages in #general"

> "Search for messages about 'project update'"

## Available Tools

| Tool | What it does |
|------|--------------|
| `slack_list_channels` | Lists all public channels |
| `slack_get_channel_history` | Gets messages from a channel |
| `slack_get_thread_replies` | Gets replies in a thread |
| `slack_list_users` | Lists workspace members |
| `slack_get_user_profile` | Gets a user's profile |
| `slack_search_messages` | Searches messages |

## Troubleshooting

### "missing_scope" error
Add the required scope in Slack App settings and reinstall the app.

### "not_in_channel" error
Invite the bot to the channel: `/invite @MCP Slack Reader`

### "rate_limited" error
Wait the indicated time and retry. The server handles rate limits automatically.

### Server not connecting
1. Check token is set: `echo $SLACK_BOT_TOKEN`
2. Verify Claude Desktop config path is correct
3. Check Claude Desktop logs: `~/Library/Logs/Claude/`
