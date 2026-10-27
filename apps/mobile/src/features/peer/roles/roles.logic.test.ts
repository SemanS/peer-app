import type { PeerCoordSession, PeerHubStatus, PeerRoleRow } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { taskRoleRows, threadRoleChip } from "./roles.logic";

type Status = Pick<PeerHubStatus, "plugins" | "roles" | "mcp" | "coordination" | "email">;

const row = (session: string, extra: Partial<PeerRoleRow> = {}): PeerRoleRow => ({
  session,
  role: "review",
  email: "slavo@acme.test",
  environment: "env-1",
  setBy: "person",
  at: "2026-10-28T10:00:00Z",
  ...extra,
});

const session = (id: string, task: string | undefined, label = "Review VL7"): PeerCoordSession => ({
  id,
  workspace: "acme",
  project: "shop",
  email: "slavo@acme.test",
  label,
  task,
  status: "working",
  files: [],
  claims: [],
  local: true,
});

const status = (input: {
  rows?: ReadonlyArray<PeerRoleRow>;
  sessions?: ReadonlyArray<PeerCoordSession>;
  mcpSessions?: ReadonlyArray<string>;
  active?: boolean;
  email?: string | null;
}): Status =>
  ({
    plugins: [
      { id: "roles", title: "Review sessions", enabled: true, active: input.active ?? true },
    ],
    roles: {
      projects: [
        { workspace: "acme", project: "shop", at: "2026-10-28T10:00:00Z", roles: input.rows ?? [] },
      ],
      threads: [],
    },
    mcp:
      input.mcpSessions === undefined
        ? undefined
        : { enabled: true, command: "peer", agents: [], clients: [], sessions: input.mcpSessions },
    coordination: { sessions: input.sessions ?? [] },
    email: input.email === undefined ? "ana@acme.test" : input.email,
  }) as unknown as Status;

const members = [
  { email: "slavo@acme.test", name: "Slavo" },
  { email: "ana@acme.test", name: "Ana" },
];
const place = { workspace: "acme", project: "shop", task: "VL7" };

describe("a review session's chip on its agent's card", () => {
  it("reads reviewing in the team's color for a herdr Claude session Peer enforces", () => {
    const chip = threadRoleChip(status({ rows: [row("claude:abc")] }), {
      key: "herdr:claude:abc",
      harness: "claude",
    });
    expect(chip).toMatchObject({ label: "reviewing", tone: "team" });
    expect(chip?.detail).toContain("Peer denies its edits");
  });

  it("says advisory, in amber, where the session is bound over MCP only", () => {
    const chip = threadRoleChip(
      status({ rows: [row("claude:abc")], mcpSessions: ["claude:abc"] }),
      { key: "herdr:claude:abc" },
    );
    expect(chip).toMatchObject({ label: "reviewing · advisory", tone: "needs" });
    expect(chip?.detail).toContain("cannot stop its edits");
  });

  it("is absent without a role or with the plugin off", () => {
    expect(threadRoleChip(status({}), { key: "herdr:claude:abc" })).toBeNull();
    expect(
      threadRoleChip(status({ rows: [row("claude:abc")], active: false }), {
        key: "herdr:claude:abc",
      }),
    ).toBeNull();
    expect(threadRoleChip(null, { key: "herdr:claude:abc" })).toBeNull();
  });
});

describe("the review sessions of the selected task", () => {
  it("lists the sessions on the task that have a role, newest first, by person", () => {
    const rows = taskRoleRows(
      status({
        rows: [
          row("claude:old", { at: "2026-10-28T09:00:00Z" }),
          row("codex:new", { email: "ana@acme.test", at: "2026-10-28T11:00:00Z" }),
          row("claude:elsewhere"),
        ],
        sessions: [
          session("claude:old", "VL7", "Check the totals"),
          session("codex:new", "VL7", "Second look"),
          session("claude:elsewhere", "VL8"),
        ],
      }),
      place,
      members,
    );
    expect(rows.map((r) => [r.who, r.session, r.label])).toEqual([
      ["You", "Second look", "reviewing"],
      ["Slavo", "Check the totals", "reviewing"],
    ]);
  });

  it("marks a session whose files changed through the shell", () => {
    const [only] = taskRoleRows(
      status({
        rows: [row("claude:abc", { changedFiles: true })],
        sessions: [session("claude:abc", "VL7")],
      }),
      place,
      members,
    );
    expect(only?.tone).toBe("needs");
    expect(only?.detail).toContain("should revert them");
  });

  it("calls a Cursor session's review advisory and names an unlisted person by address", () => {
    const [only] = taskRoleRows(
      status({
        rows: [row("cursor:abc", { email: "cyril@acme.test" })],
        sessions: [session("cursor:abc", "VL7")],
      }),
      place,
      members,
    );
    expect(only).toMatchObject({ who: "cyril@acme.test", label: "reviewing · advisory" });
  });

  it("shows nothing with the plugin off", () => {
    expect(
      taskRoleRows(
        status({
          rows: [row("claude:abc")],
          sessions: [session("claude:abc", "VL7")],
          active: false,
        }),
        place,
        members,
      ),
    ).toEqual([]);
  });
});
