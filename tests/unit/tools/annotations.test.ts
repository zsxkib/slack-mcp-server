import { describe, it, expect, vi } from "vitest";

// Mock server to capture tool registrations including opts
vi.mock("../../../src/server.js", () => {
  const registrations = new Map<string, { opts: Record<string, unknown>; handler: Function }>();
  return {
    server: {
      registerTool: (name: string, opts: Record<string, unknown>, handler: Function) => {
        registrations.set(name, { opts, handler });
      },
      _registrations: registrations,
    },
  };
});

// Mock Slack client (needed by tool imports)
vi.mock("../../../src/slack/client.js", () => ({
  getSlackClient: () => ({}),
  isSearchAvailable: () => true,
  isRefreshAvailable: () => true,
  getAuthType: () => "user",
}));

vi.mock("../../../src/refresh/scheduler.js", () => ({
  getScheduler: () => ({ triggerManual: vi.fn() }),
}));

// Mock memory config so memory tools register
vi.mock("../../../src/config/memory.js", () => ({
  isMemoryAvailable: () => true,
  getMemoryDir: () => "/tmp/fake-memory",
}));

vi.mock("../../../src/memory/index.js", () => ({
  searchMemory: vi.fn(),
  resetIndex: vi.fn(),
}));

// Import all tool modules so they register
import { server } from "../../../src/server.js";
import "../../../src/tools/channels.js";
import "../../../src/tools/messages.js";
import "../../../src/tools/search.js";
import "../../../src/tools/users.js";
import "../../../src/tools/refresh.js";
import "../../../src/tools/memory.js";

const registrations = (server as any)._registrations as Map<
  string,
  { opts: Record<string, unknown>; handler: Function }
>;

function getAnnotations(toolName: string) {
  const reg = registrations.get(toolName);
  if (!reg) throw new Error(`Tool ${toolName} not registered`);
  return reg.opts.annotations as Record<string, unknown> | undefined;
}

describe("tool annotations", () => {
  const readOnlyTools = [
    "list_channels",
    "get_channel_history",
    "get_thread_replies",
    "list_users",
    "get_user_profile",
    "search_messages",
    "read_memory",
    "search_memory",
  ];

  const writeTools = [
    "refresh_credentials",
    "update_memory",
  ];

  const idempotentTools = [
    "list_channels",
    "get_channel_history",
    "get_thread_replies",
    "list_users",
    "get_user_profile",
    "search_messages",
    "refresh_credentials",
    "read_memory",
    "search_memory",
  ];

  const openWorldTools = [
    "list_channels",
    "get_channel_history",
    "get_thread_replies",
    "list_users",
    "search_messages",
  ];

  it("all 10 tools are registered", () => {
    expect(registrations.size).toBe(10);
  });

  it.each(readOnlyTools)("%s has readOnlyHint: true", (tool) => {
    expect(getAnnotations(tool)?.readOnlyHint).toBe(true);
  });

  it.each(writeTools)("%s has destructiveHint: false", (tool) => {
    expect(getAnnotations(tool)?.destructiveHint).toBe(false);
  });

  it.each(writeTools)("%s does NOT have readOnlyHint", (tool) => {
    expect(getAnnotations(tool)?.readOnlyHint).toBeUndefined();
  });

  it.each(idempotentTools)("%s has idempotentHint: true", (tool) => {
    expect(getAnnotations(tool)?.idempotentHint).toBe(true);
  });

  it("update_memory does NOT have idempotentHint", () => {
    expect(getAnnotations("update_memory")?.idempotentHint).toBeUndefined();
  });

  it.each(openWorldTools)("%s has openWorldHint: true", (tool) => {
    expect(getAnnotations(tool)?.openWorldHint).toBe(true);
  });

  it("get_user_profile does NOT have openWorldHint", () => {
    expect(getAnnotations("get_user_profile")?.openWorldHint).toBeUndefined();
  });

  it("memory tools do NOT have openWorldHint", () => {
    expect(getAnnotations("read_memory")?.openWorldHint).toBeUndefined();
    expect(getAnnotations("search_memory")?.openWorldHint).toBeUndefined();
    expect(getAnnotations("update_memory")?.openWorldHint).toBeUndefined();
  });
});
