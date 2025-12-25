# Implementation Plan: Slack MCP Server (Read-Only)

**Branch**: `001-slack-mcp-read-only` | **Date**: 2025-12-25 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-slack-mcp-read-only/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Build a read-only MCP server that exposes Slack workspace data to AI assistants. The server provides 6 core tools: list channels, get message history, get thread replies, list users, get user profile, and search messages. All operations are read-only with no data modification capabilities.

## Technical Context

**Language/Version**: TypeScript with Node.js 20+
**Primary Dependencies**: @modelcontextprotocol/sdk, @slack/web-api, zod
**Storage**: N/A (stateless proxy to Slack API)
**Testing**: vitest
**Target Platform**: Server (stdio transport for MCP client integration)
**Project Type**: Single
**Performance Goals**: <2s response time for channel lists (500 channels), <2s for message history (50 messages)
**Constraints**: Handle Slack rate limits gracefully (Tier 2-3 limits), support cursor-based pagination
**Scale/Scope**: Workspaces with up to 500 channels, standard Slack rate limits

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Pre-Phase 0 Assessment

| Principle | Status | Justification |
|-----------|--------|---------------|
| **I. Simplicity Over Complexity** | ✅ PASS | Single-purpose server with 6 tools mapping directly to Slack API endpoints. No custom abstractions—direct SDK wrapping. Single project structure. |
| **II. Human-Reviewable Outputs** | ✅ PASS | Scope limited to read-only operations. ~6 tool implementations, each <100 LOC. Entire codebase reviewable in single session. |

**Gate Result**: PASSED - Proceed to Phase 0

### Post-Phase 1 Assessment

| Principle | Status | Justification |
|-----------|--------|---------------|
| **I. Simplicity Over Complexity** | ✅ PASS | Design maintains simplicity: 6 tools → 6 Slack API methods. No caching layer, no ORM, no custom abstractions. Data model is direct projection of Slack responses. |
| **II. Human-Reviewable Outputs** | ✅ PASS | Artifacts reviewable: data-model.md (~150 lines), contracts/mcp-tools.md (~200 lines), quickstart.md (~80 lines). Total design docs <500 lines. |

**Gate Result**: PASSED - Ready for Phase 2 task generation

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── index.ts              # Server entry point, transport setup
├── server.ts             # McpServer initialization, tool registration
├── tools/                # MCP tool implementations
│   ├── channels.ts       # slack_list_channels
│   ├── messages.ts       # slack_get_channel_history, slack_get_thread_replies
│   ├── users.ts          # slack_list_users, slack_get_user_profile
│   └── search.ts         # slack_search_messages
├── slack/                # Slack API client wrapper
│   ├── client.ts         # WebClient initialization, error handling
│   └── types.ts          # Slack response type definitions
└── utils/
    ├── errors.ts         # Error mapping (Slack → MCP)
    └── pagination.ts     # Cursor-based pagination helpers

tests/
├── unit/                 # Tool logic tests with mocked Slack client
│   └── tools/
└── integration/          # Optional: Tests with real Slack API
```

**Structure Decision**: Single project structure. All source in `src/`, tests in `tests/`. Tools organized by domain (channels, messages, users, search). Slack client wrapper isolated in `src/slack/` for testability.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

*No violations. All principles satisfied.*
