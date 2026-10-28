import { describe, expect, it } from "vite-plus/test";

import {
  ROLE_MENU,
  canStartReview,
  isAdvisory,
  reviewHarness,
  roleMenuItem,
  sessionOfThread,
  threadPlace,
  threadRole,
  type RolesStatusView,
} from "./roles.ts";

const plugins = [{ id: "roles", active: true }] as unknown as RolesStatusView["plugins"];

const row = (session: string, extra: { changedFiles?: boolean } = {}) => ({
  session,
  role: "review",
  email: "slavo@example.com",
  environment: "env-1",
  setBy: "person",
  at: "2026-10-28T10:00:00Z",
  ...extra,
});

const status = (
  over: { roles?: RolesStatusView["roles"]; mcp?: string[]; active?: boolean } = {},
): RolesStatusView =>
  ({
    plugins: over.active === false ? [{ id: "roles", active: false }] : plugins,
    roles: over.roles ?? {
      projects: [
        {
          workspace: "acme",
          project: "web",
          at: "2026-10-28T10:00:00Z",
          roles: [row("claude:a1"), row("cursor:c1"), row("codex:x1", { changedFiles: true })],
        },
      ],
      threads: [
        {
          thread: "peer:t1",
          workspace: "acme",
          project: "web",
          role: "review",
          at: "2026-10-28T10:00:00Z",
        },
      ],
    },
    mcp:
      over.mcp === undefined
        ? undefined
        : { enabled: true, command: "", agents: [], clients: [], sessions: over.mcp },
  }) as RolesStatusView;

describe("session roles", () => {
  it("reads a herdr agent's session from its thread key, a colleague's too", () => {
    expect(sessionOfThread("herdr:claude:a1")).toBe("claude:a1");
    expect(sessionOfThread("env-2:herdr:codex:x1")).toBe("codex:x1");
    expect(sessionOfThread("peer:t1")).toBeUndefined();
    expect(sessionOfThread("herdr:term")).toBeUndefined();
  });

  it("labels a review session reviewing, and advisory where Peer cannot stop its edits", () => {
    expect(threadRole(status(), { key: "herdr:claude:a1" })).toMatchObject({
      label: "reviewing",
      advisory: false,
      session: "claude:a1",
    });
    const cursor = threadRole(status(), { key: "env-2:herdr:cursor:c1" });
    expect(cursor?.label).toBe("reviewing · advisory");
    expect(cursor?.detail).toContain("Peer cannot stop its edits");
    expect(threadRole(status({ mcp: ["claude:a1"] }), { key: "herdr:claude:a1" })?.label).toBe(
      "reviewing · advisory",
    );
    expect(threadRole(status(), { key: "herdr:codex:x1" })?.detail).toContain("should revert");
  });

  it("reads the role a person gave their thread before its session reports", () => {
    expect(threadRole(status(), { key: "peer:t1" })).toMatchObject({
      label: "reviewing",
      session: undefined,
    });
    expect(threadRole(status(), { key: "peer:t1", harness: "opencode" })?.advisory).toBe(true);
    expect(threadRole(status(), { key: "peer:t2" })).toBeUndefined();
  });

  it("shows nothing while the plugin is inactive", () => {
    expect(threadRole(status({ active: false }), { key: "herdr:claude:a1" })).toBeUndefined();
    expect(threadRole(null, { key: "herdr:claude:a1" })).toBeUndefined();
  });

  it("calls only harnesses without Peer's edit hooks advisory", () => {
    expect(isAdvisory({ harness: "claude" })).toBe(false);
    expect(isAdvisory({ harness: "Codex" })).toBe(false);
    expect(isAdvisory({ harness: "cursor" })).toBe(true);
    expect(isAdvisory({})).toBe(false);
    expect(isAdvisory({ session: "claude:a", mcpSessions: ["claude:a"] })).toBe(true);
  });

  it("offers the role items to the thread's own person on this computer only", () => {
    const mine = { mine: true, localEnvironment: true, stale: false };
    const role = threadRole(status(), { key: "peer:t1" });
    expect(roleMenuItem(mine, undefined)).toBe(ROLE_MENU.set);
    expect(roleMenuItem(mine, role)).toBe(ROLE_MENU.clear);
    expect(roleMenuItem({ ...mine, stale: true }, undefined)).toBeNull();
    expect(roleMenuItem({ ...mine, stale: true }, role)).toBe(ROLE_MENU.clear);
    expect(roleMenuItem({ ...mine, mine: false }, role)).toBeNull();
    expect(roleMenuItem({ ...mine, localEnvironment: false }, undefined)).toBeNull();
  });

  it("offers Start a review on an open task while the plugin is active", () => {
    const active = { plugins } as Parameters<typeof canStartReview>[0];
    expect(canStartReview(active, { done: false })).toBe(true);
    expect(canStartReview(active, { done: true })).toBe(false);
    expect(canStartReview(status({ active: false }), { done: false })).toBe(false);
  });

  it("reviews in the harness the task was last built in, else Claude Code", () => {
    expect(reviewHarness([{ harness: "claude" }, { harness: "codex" }])).toBe("codex");
    expect(reviewHarness([{ harness: "codex" }, { harness: "cursor" }])).toBe("codex");
    expect(reviewHarness([{ harness: undefined }])).toBe("claude");
  });

  it("places a thread by the role its person gave it, or by its report", () => {
    const hub = {
      email: "slavo@example.com",
      environmentId: "env-1",
      roles: { projects: [], threads: [] },
      workspaces: [
        {
          slug: "acme",
          projects: [
            {
              project: { id: "web" },
              work: {
                assignments: { "herdr:term": "VL7" },
                threads: [{ id: "peer:t9", email: "slavo@example.com", environment: "env-1" }],
              },
            },
          ],
        },
      ],
    } as unknown as Parameters<typeof threadPlace>[0];
    expect(threadPlace(hub, "herdr:term")).toEqual({ workspace: "acme", project: "web" });
    expect(threadPlace(hub, "peer:t9")).toEqual({ workspace: "acme", project: "web" });
    expect(threadPlace(hub, "peer:other")).toBeUndefined();
    expect(threadPlace(null, "peer:t9")).toBeUndefined();
  });
});
