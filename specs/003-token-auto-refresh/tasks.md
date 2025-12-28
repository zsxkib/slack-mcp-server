# Tasks: Slack User Token and D Cookie Auto Refresh

**Input**: Design documents from `/specs/003-token-auto-refresh/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/refresh-tool.md

**Tests**: Included as specified in plan.md project structure.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root (per plan.md)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create project structure for refresh subsystem

- [X] T001 Create directory structure `src/refresh/` for refresh subsystem
- [X] T002 [P] Add refresh-related type definitions to `src/slack/types.ts` (StoredCredentials, RefreshState, RefreshError, RefreshSchedule, RefreshResult, RefreshErrorCode, RefreshStatus)
- [X] T003 [P] Add refresh-related error types to `src/utils/errors.ts` (RefreshError class with error codes)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Implement credential storage module in `src/refresh/storage.ts` (load, save, exists methods with atomic writes and 0600 permissions)
- [X] T005 Create Zod validation schemas for StoredCredentials in `src/refresh/storage.ts` (validate token prefix xoxc-, cookie prefix xoxd-, workspace non-empty)
- [X] T006 [P] Add environment variable parsing for refresh config in `src/slack/client.ts` (SLACK_CREDENTIALS_PATH, SLACK_REFRESH_INTERVAL_DAYS, SLACK_WORKSPACE, SLACK_REFRESH_ENABLED)

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Seamless Authentication Continuity (Priority: P1) 🎯 MVP

**Goal**: Automatically refresh Slack user credentials before they expire so operators don't experience service interruptions or need manual token updates.

**Independent Test**: Simulate an expiring token scenario and verify the system obtains fresh credentials without user intervention.

### Tests for User Story 1

- [X] T007 [P] [US1] Unit test for storage module in `tests/unit/storage.test.ts` (load, save, atomic writes, permissions, validation)
- [X] T008 [P] [US1] Unit test for RefreshManager in `tests/unit/refresh-manager.test.ts` (successful refresh flow, credential update, state transitions)
- [X] T009 [P] [US1] Unit test for scheduler in `tests/unit/scheduler.test.ts` (interval checks, trigger on due, start/stop)

### Implementation for User Story 1

- [X] T010 [US1] Implement RefreshManager class in `src/refresh/manager.ts` (orchestrate refresh lifecycle, call Slack workspace to refresh both xoxc token and d cookie)
- [X] T011 [US1] Implement HTTP request to Slack workspace in `src/refresh/manager.ts` (GET https://[workspace].slack.com with d cookie, parse api_token from body and new d cookie from Set-Cookie header)
- [X] T012 [US1] Implement credential validation in `src/refresh/manager.ts` (validate refreshed credentials before replacing current ones using auth.test API)
- [X] T013 [US1] Implement RefreshScheduler class in `src/refresh/scheduler.ts` (interval-based refresh check every hour, calculate next refresh due date)
- [X] T014 [US1] Extend SlackClient with refresh capability in `src/slack/client.ts` (integrate with RefreshManager, use persisted credentials)
- [X] T015 [US1] Integrate refresh initialization on server startup in `src/server.ts` (validate credentials, initialize refresh scheduling for user token auth)
- [X] T016 [US1] Add logging for refresh events in `src/refresh/manager.ts` (success, scheduled next refresh)

**Checkpoint**: Automatic credential refresh works end-to-end. Server can run continuously with credentials auto-refreshed every 7 days.

---

## Phase 4: User Story 2 - Graceful Refresh Failure Handling (Priority: P2)

**Goal**: Provide clear notification and graceful degradation when credential refresh fails so operators can take corrective action before complete service loss.

**Independent Test**: Intentionally block refresh requests and verify appropriate error messaging and retry behavior.

### Tests for User Story 2

- [X] T017 [P] [US2] Unit test for retry logic in `tests/unit/refresh-manager.test.ts` (exponential backoff, max 3 attempts, jitter)
- [X] T018 [P] [US2] Unit test for error classification in `tests/unit/refresh-manager.test.ts` (NETWORK_ERROR retryable, SESSION_REVOKED not retryable)

### Implementation for User Story 2

- [X] T019 [US2] Implement retry with exponential backoff in `src/refresh/manager.ts` (base 1s, multiplier 2x, max 30s cap, +/-25% jitter, max 3 attempts)
- [X] T020 [US2] Implement error classification in `src/refresh/manager.ts` (NETWORK_ERROR, RATE_LIMITED, SESSION_REVOKED, INVALID_RESPONSE, STORAGE_ERROR)
- [X] T021 [US2] Implement graceful degradation in `src/refresh/manager.ts` (continue with existing credentials when refresh fails until they expire)
- [X] T022 [US2] Add detailed error logging in `src/refresh/manager.ts` (log all refresh events: success, failure, retry with error details)
- [X] T023 [US2] Implement session revoked handling in `src/refresh/manager.ts` (detect SESSION_REVOKED, notify with guidance on resolution)
- [X] T024 [US2] Track consecutive failures in RefreshState in `src/refresh/manager.ts` (reset on success, increment on failure)

**Checkpoint**: Refresh failures are handled gracefully. System logs detailed errors, retries with backoff, and continues operating with current credentials.

---

## Phase 5: User Story 3 - Manual Refresh Trigger (Priority: P3)

**Goal**: Allow operators to manually trigger credential refresh when needed (e.g., after network recovery, before planned maintenance).

**Independent Test**: Invoke manual refresh and verify new credentials are obtained regardless of current token expiration status.

### Tests for User Story 3

- [X] T025 [P] [US3] Integration test for manual refresh in `tests/integration/refresh-flow.test.ts` (tool invocation, success response, error responses)
- [X] T026 [P] [US3] Unit test for refresh tool handler in `tests/unit/refresh-manager.test.ts` (concurrent request handling, REFRESH_IN_PROGRESS response)

### Implementation for User Story 3

- [X] T027 [US3] Create refresh_credentials MCP tool handler in `src/tools/refresh.ts` (input schema empty, output schema with success/failure discriminated union)
- [X] T028 [US3] Implement concurrent refresh guard in `src/refresh/manager.ts` (only one refresh at a time, return REFRESH_IN_PROGRESS for subsequent requests)
- [X] T029 [US3] Implement bot token check in `src/tools/refresh.ts` (return REFRESH_NOT_AVAILABLE for bot token auth)
- [X] T030 [US3] Register refresh_credentials tool in `src/server.ts` (add tool registration with description and schema)
- [X] T031 [US3] Implement manual trigger flag in RefreshState in `src/refresh/manager.ts` (distinguish auto vs manual refresh in logs and state)

**Checkpoint**: Manual refresh tool is available and works correctly. Operators can trigger refresh on-demand.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and improvements that affect multiple user stories

- [X] T032 End-to-end integration test in `tests/integration/refresh-flow.test.ts` (full refresh cycle: startup → auto-refresh → manual refresh → error handling)
- [X] T033 Validate implementation against quickstart.md scenarios
- [X] T034 [P] Verify backward compatibility with bot token authentication (no refresh, no persistence, no errors)
- [X] T035 [P] Ensure all environment variables documented and working (SLACK_CREDENTIALS_PATH, SLACK_REFRESH_INTERVAL_DAYS, SLACK_WORKSPACE, SLACK_REFRESH_ENABLED)
- [X] T036 Code cleanup and ensure consistent error handling patterns across refresh subsystem
- [X] T037 Run full test suite (`pnpm test`) and verify all tests pass
- [X] T038 Run linting (`pnpm run lint`) and fix any issues

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup (T001-T003) - BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational (T004-T006)
- **User Story 2 (Phase 4)**: Depends on User Story 1 core implementation (T010-T012)
- **User Story 3 (Phase 5)**: Depends on User Story 1 core implementation (T010-T012)
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational - No dependencies on other stories
- **User Story 2 (P2)**: Builds on US1's RefreshManager - enhances error handling
- **User Story 3 (P3)**: Builds on US1's RefreshManager - adds manual trigger interface

### Within Each User Story

- Tests written and verified to fail before implementation
- Types/schemas before core logic
- Core logic before integrations
- Unit tests before integration tests
- Story complete before moving to next priority

### Parallel Opportunities

**Phase 1 (Setup)**:
```
T001 (create directory)
   ↓
T002 [P] (types.ts) + T003 [P] (errors.ts)  ← can run in parallel
```

**Phase 2 (Foundational)**:
```
T004 (storage) → T005 (schemas)
       ↓
T006 [P] (env parsing)  ← can run in parallel with T004
```

**Phase 3 (User Story 1)**:
```
T007 [P] + T008 [P] + T009 [P]  ← all tests can run in parallel
           ↓
T010 → T011 → T012 → T013 → T014 → T015 → T016  ← sequential
```

**Phase 4 (User Story 2)**:
```
T017 [P] + T018 [P]  ← tests can run in parallel
         ↓
T019 → T020 → T021 → T022 → T023 → T024  ← sequential
```

**Phase 5 (User Story 3)**:
```
T025 [P] + T026 [P]  ← tests can run in parallel
         ↓
T027 → T028 → T029 → T030 → T031  ← sequential
```

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task T007: "Unit test for storage module in tests/unit/storage.test.ts"
Task T008: "Unit test for RefreshManager in tests/unit/refresh-manager.test.ts"
Task T009: "Unit test for scheduler in tests/unit/scheduler.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 2: Foundational (T004-T006)
3. Complete Phase 3: User Story 1 (T007-T016)
4. **STOP and VALIDATE**: Test auto-refresh independently
5. Server can now run continuously with auto-refresh

### Incremental Delivery

1. Setup + Foundational → Core infrastructure ready
2. Add User Story 1 → Test independently → Deployable MVP
3. Add User Story 2 → Test independently → Enhanced error handling
4. Add User Story 3 → Test independently → Full feature complete
5. Each story adds value without breaking previous stories

### Key Files Modified/Created

| File | Action | User Story |
|------|--------|------------|
| `src/refresh/storage.ts` | CREATE | Foundation/US1 |
| `src/refresh/manager.ts` | CREATE | US1, US2 |
| `src/refresh/scheduler.ts` | CREATE | US1 |
| `src/tools/refresh.ts` | CREATE | US3 |
| `src/slack/types.ts` | MODIFY | Setup |
| `src/slack/client.ts` | MODIFY | Foundation/US1 |
| `src/server.ts` | MODIFY | US1, US3 |
| `src/utils/errors.ts` | MODIFY | Setup |
| `tests/unit/storage.test.ts` | CREATE | US1 |
| `tests/unit/refresh-manager.test.ts` | CREATE | US1, US2, US3 |
| `tests/unit/scheduler.test.ts` | CREATE | US1 |
| `tests/integration/refresh-flow.test.ts` | CREATE | US3, Polish |

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
