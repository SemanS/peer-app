import type { PeerHubStatus, PeerRoleRow } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  ANA,
  BOB,
  EVA,
  NOW,
  coordSession,
  statusFor,
  teamProject,
} from "../ownership/ownership.testkit";
import {
  CHANGED_FILES_LINE,
  anotherReviewQuestion,
  reviewLaunch,
  taskRoleRows,
  teamSignals,
  teamTaskFacts,
} from "./roles.logic";

type Props = Parameters<typeof reviewLaunch>[0];

const props = (
  over: {
    active?: boolean;
    done?: boolean;
    ready?: boolean;
    harnesses?: Array<string | undefined>;
    project?: boolean;
  } = {},
): Props =>
  ({
    status: { plugins: [{ id: "roles", active: over.active ?? true }] },
    workspace: "acme",
    project:
      over.project === false
        ? undefined
        : {
            project: { id: "web" },
            repositories: [
              { id: "app", state: over.ready === false ? "cloning" : "ready" },
              { id: "docs", state: "ready" },
            ],
          },
    task: {
      id: "t7",
      key: "VL7",
      title: "Checkout totals",
      done: over.done ?? false,
      threads: (over.harnesses ?? []).map((harness) => ({ harness })),
    },
  }) as unknown as Props;

describe("Start a review", () => {
  it("starts on an open task in the first ready checkout and the harness it was built in", () => {
    expect(reviewLaunch(props({ harnesses: ["codex", "cursor"] }))).toEqual({
      input: {
        workspace: "acme",
        projectId: "web",
        taskId: "t7",
        repositoryId: "app",
        harness: "codex",
      },
      label: expect.stringContaining("VL7"),
    });
    expect(reviewLaunch(props({ ready: false }))?.input.repositoryId).toBe("docs");
    expect(reviewLaunch(props())?.input.harness).toBe("claude");
  });

  it("is not offered on a done task, while the plugin is inactive, or without the project", () => {
    expect(reviewLaunch(props({ done: true }))).toBeNull();
    expect(reviewLaunch(props({ active: false }))).toBeNull();
    expect(reviewLaunch(props({ project: false }))).toBeNull();
  });
});

const roleRow = (
  session: string,
  email: string,
  extra: Partial<PeerRoleRow> = {},
): PeerRoleRow => ({
  session,
  role: "review",
  email,
  environment: `${email}-laptop`,
  setBy: "person",
  at: "2026-10-12T20:00:00Z",
  ...extra,
});

/** Eva's Peer, where the Hub reports review sessions on ordering's tasks. */
const withRoles = (
  rows: ReadonlyArray<PeerRoleRow>,
  sessions: ReadonlyArray<Record<string, unknown>>,
  mcpSessions: ReadonlyArray<string> = [],
): PeerHubStatus => {
  const status = statusFor(EVA, { sessions });
  return {
    ...status,
    plugins: [{ id: "roles", title: "Review sessions", enabled: true, active: true }],
    roles: {
      projects: [
        { workspace: "acme", project: "ordering", at: "2026-10-12T20:00:00Z", roles: rows },
      ],
      threads: [],
    },
    mcp: { enabled: true, command: "peer", agents: [], clients: [], sessions: mcpSessions },
  } as unknown as PeerHubStatus;
};

const MEMBERS = [
  { email: ANA, name: "Ana" },
  { email: EVA, name: "Eva" },
];
const ON_VL7 = { workspace: "acme", project: "ordering", task: "vl7" };
const VL7 = { id: "vl7", key: "VL7", title: "Receipt totals in cents" };

describe("a task's review sessions", () => {
  it("lists each session on the task with its person, label and role, newest first", () => {
    const status = withRoles(
      [
        roleRow("claude:a", ANA, { at: "2026-10-12T19:00:00Z" }),
        roleRow("cursor:e", EVA, { at: "2026-10-12T20:30:00Z" }),
        roleRow("claude:b", BOB),
      ],
      [
        coordSession("claude:a", ANA, "vl7", { label: "Review VL7" }),
        coordSession("cursor:e", EVA, "vl7", { label: "Second look" }),
        coordSession("claude:b", BOB, "vl9"),
      ],
    );
    const rows = taskRoleRows(status, ON_VL7, MEMBERS);
    expect(rows.map(({ who, session, label }) => ({ who, session, label }))).toEqual([
      { who: "You", session: "Second look", label: "reviewing · advisory" },
      { who: "Ana", session: "Review VL7", label: "reviewing" },
    ]);
    expect(rows[0]?.detail).toContain("cannot stop its edits");
  });

  it("says advisory for an MCP-only session and flags one that changed files", () => {
    const status = withRoles(
      [roleRow("claude:a", ANA, { changedFiles: true })],
      [coordSession("claude:a", ANA, "vl7")],
      ["claude:a"],
    );
    const [row] = taskRoleRows(status, ON_VL7, MEMBERS);
    expect(row).toMatchObject({ label: "reviewing · advisory", changedFiles: true });
    expect(row?.detail).not.toContain(CHANGED_FILES_LINE);
  });

  it("lists nothing while the plugin is inactive", () => {
    const status = withRoles([roleRow("claude:a", ANA)], [coordSession("claude:a", ANA, "vl7")]);
    const off = { ...status, plugins: [{ id: "roles", title: "", enabled: true, active: false }] };
    expect(taskRoleRows(off as PeerHubStatus, ON_VL7, MEMBERS)).toEqual([]);
  });
});

describe("another review of a task", () => {
  const task = (keys: ReadonlyArray<string>) =>
    ({
      key: "VL7",
      title: "Checkout totals",
      threads: keys.map((key) => ({ key })),
    }) as unknown as Props["task"];
  const status = withRoles(
    [roleRow("claude:a", ANA), roleRow("claude:b", ANA), roleRow("claude:c", ANA, { role: "qa" })],
    [],
  );

  it("does not ask before a task's first review", () => {
    expect(anotherReviewQuestion({ status, task: task(["herdr:claude:other"]) })).toBeNull();
    expect(anotherReviewQuestion({ status, task: task(["herdr:claude:c"]) })).toBeNull();
  });

  it("names how many review chats the task already has", () => {
    expect(anotherReviewQuestion({ status, task: task(["herdr:claude:a"]) })).toContain(
      "VL7 · Checkout totals already has a review chat.",
    );
    expect(
      anotherReviewQuestion({ status, task: task(["herdr:claude:a", "herdr:claude:b"]) }),
    ).toContain("VL7 · Checkout totals already has 2 review chats.");
  });
});

describe("review sessions on the Team page", () => {
  it("names who reviews a task, never the session's label", () => {
    const status = withRoles([roleRow("claude:a", ANA)], [coordSession("claude:a", ANA, "vl7")]);
    const project = teamProject(EVA);
    const fact = teamTaskFacts({ status, project, now: NOW, task: VL7 });
    expect(fact).toMatchObject({ id: "roles", text: "reviewing · Ana", tone: "team" });
    expect(fact?.text).not.toContain("SECRET");
    expect(
      teamTaskFacts({ status, project, now: NOW, task: { ...VL7, id: "vl9" } }),
    ).toBeUndefined();
    expect(teamSignals({ status, project, now: NOW })).toEqual([]);
  });

  it("says changed files and signals the task when a review session changed files", () => {
    const status = withRoles(
      [roleRow("claude:a", ANA, { changedFiles: true })],
      [coordSession("claude:a", ANA, "vl7")],
    );
    const project = teamProject(EVA);
    expect(teamTaskFacts({ status, project, now: NOW, task: VL7 })).toMatchObject({
      text: "reviewing · changed files",
      tone: "needs",
    });
    const signals = teamSignals({ status, project, now: NOW });
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      id: "changed-files:vl7",
      what: "VL7: a review session changed files",
      since: "2026-10-12T20:00:00Z",
      action: { label: "Open task" },
    });
    expect(signals[0]?.detail).toContain("Ana");
  });
});
