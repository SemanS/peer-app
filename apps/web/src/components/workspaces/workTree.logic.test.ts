import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type PeerHubStatus,
  type PeerProjectState,
  type PeerTask,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { describe, expect, it } from "vite-plus/test";

import { herdrMenuItem } from "./herdr/threadMenu";
import { observeMenuItem } from "./observe/threadMenu";
import { taskMenuItems, threadMenuItems } from "./workMenus.logic";
import { buildWorkTree, type WorkThreadNode } from "./workTree.logic";

const HERE = EnvironmentId.make("env-here");
const KIRKWOOD_T3 = ProjectId.make("t3-kirkwood");
const NOW = Date.parse("2026-10-03T12:00:00Z");

function task(id: string, title: string, area: string | undefined, key?: string): PeerTask {
  return {
    id,
    title,
    status: "open",
    createdBy: "slavo@acme.test",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    ...(area === undefined ? {} : { area }),
    ...(key === undefined ? {} : { key }),
  };
}

/** A local thread with only what the work tree reads. */
function shell(
  id: string,
  title: string,
  overrides: Partial<EnvironmentThreadShell> = {},
): EnvironmentThreadShell {
  return {
    environmentId: HERE,
    id: ThreadId.make(id),
    projectId: KIRKWOOD_T3,
    title,
    branch: null,
    runtime: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    settledAt: null,
    archivedAt: null,
    deletedAt: null,
    modelSelection: { instanceId: "claudeAgent", model: "claude-sonnet-5-5" },
    latestUserMessageAt: null,
    updatedAt: "2026-10-03T11:00:00Z",
    ...overrides,
  } as unknown as EnvironmentThreadShell;
}

function kirkwood(): PeerProjectState {
  return {
    project: {
      id: "kirkwood",
      name: "Kirkwood",
      role: "lead",
      members: [
        { email: "slavo@acme.test", name: "Slavo" },
        { email: "yev@acme.test", name: "Yev" },
        { email: "chino@acme.test", name: "Chino" },
      ],
      repositories: [{ id: "app", url: "git@example.test:acme/app.git", branch: "main" }],
      knowledge: { kontext: true, company: true },
      tools: [],
      capacity: { personal: "any", personalHarnesses: [] },
    },
    repositories: [
      {
        id: "app",
        url: "git@example.test:acme/app.git",
        branch: "main",
        path: "/w/acme/kirkwood/app",
        state: "ready",
        projectId: KIRKWOOD_T3,
      },
    ],
    tools: [],
    sharedCapacity: { enabled: false, instanceIds: [] },
    work: {
      areas: ["Groups & Events", "Revenue", "Infrastructure"],
      tasks: [
        task("krk-812", "Split Payments", "Groups & Events", "KRK-812"),
        task("partner-rec", "Partner Rec", "Revenue"),
        task("str", "STR", "Revenue"),
        task("loose", "Loose ends", undefined),
      ],
      threads: [
        {
          id: "peer:t9",
          task: "krk-812",
          title: "UI adjustments",
          email: "yev@acme.test",
          status: "working",
          source: "peer",
          environment: "yev-laptop",
          seenAt: "2026-10-03T11:59:30Z",
        },
        {
          id: "herdr:x1",
          task: "str",
          title: "Variance calculation",
          email: "chino@acme.test",
          status: "working",
          source: "herdr",
          environment: "chino-desk",
          seenAt: "2026-10-03T11:40:00Z",
        },
      ],
      runs: [
        {
          id: "run_1",
          task: "partner-rec",
          agent: "claude",
          runtime: "peer",
          state: "running",
          keys: ["peer:t2"],
        },
      ],
    },
    peers: [],
  };
}

function status(project: PeerProjectState, role: "owner" | "member" = "owner"): PeerHubStatus {
  return {
    hubUrl: "https://hub.example.test",
    signedIn: true,
    email: "slavo@acme.test",
    pendingSignIn: null,
    workspaces: [
      {
        slug: "acme",
        name: "Acme",
        role,
        allowedDomains: ["acme.test"],
        currency: "EUR",
        memberName: "Slavo",
        companyKnowledge: null,
        projects: [project],
        lastSyncAt: null,
        error: null,
      },
    ],
    joinable: [],
    workspaceRoot: "/w",
    environmentId: HERE,
    agents: {
      herdr: "running",
      list: [
        {
          id: "herdr:term1",
          paneId: "w1:p2",
          agent: "codex",
          title: "Investigation for KRK-812",
          status: "blocked",
          workspace: "acme",
          projectId: "kirkwood",
        },
        {
          id: "herdr:term2",
          paneId: "w2:p1",
          agent: "claude",
          title: "Side project",
          status: "working",
          cwd: "/Users/slavo/side",
        },
      ],
    },
    github: { cli: true, account: "slavo", signIn: null, error: null },
    coordination: {
      enabled: false,
      policy: "coordinate",
      claudeHooks: false,
      logPath: "",
      sessions: [],
      overlaps: [],
      findings: [],
      contexts: [],
      candidates: [],
    },
    sharedThreads: ["peer:t1"],
    syncing: false,
    lastSyncAt: null,
    error: null,
  };
}

const LOCAL = [
  shell("t1", "Main implementation", {
    branch: "krk-812-backend",
    runtime: { status: "running" } as EnvironmentThreadShell["runtime"],
  }),
  shell("t2", "Consolidated average", { settledAt: "2026-10-02T10:00:00Z" }),
  shell("t3", "Tidy the README"),
  shell("t4", "Archived work", { archivedAt: "2026-10-02T10:00:00Z" }),
];

describe("menus", () => {
  const [project] = buildWorkTree({ status: status(kirkwood()), localThreads: LOCAL, now: NOW });
  const split = project?.areas[0]?.tasks[0];
  const tasks = project?.tasks ?? [];
  const thread = (title: string) => split?.threads.find((t) => t.title === title);
  // What the active plugins add to a thread's menu: herdr shows an agent in herdr ahead of "Move to
  // task", observe shares after it.
  const plugged = (node: WorkThreadNode) => {
    const herdr = herdrMenuItem(node);
    const observe = observeMenuItem(node);
    return [
      ...(herdr === null ? [] : [{ item: herdr, place: "start" as const }]),
      ...(observe === null ? [] : [{ item: observe, place: "end" as const }]),
    ];
  };

  it("changes only your own threads on this computer", () => {
    const menu = (title: string) =>
      threadMenuItems({
        thread: thread(title)!,
        tasks,
        taskId: "krk-812",
        running: true,
        entries: plugged(thread(title)!),
      });
    expect(menu("UI adjustments")).toEqual([]);
    expect(menu("Investigation for KRK-812").map((item) => item.id)).toEqual([
      "show-in-herdr",
      "move",
      "share",
    ]);
    const mine = menu("Main implementation");
    expect(mine.map((item) => [item.id, item.disabled ?? false])).toEqual([
      ["rename", false],
      ["move", false],
      ["unshare", false],
      ["archive", true],
      ["delete", false],
    ]);
    const places = mine.find((item) => item.id === "move")?.children ?? [];
    expect(places.filter((item) => item.checked).map((item) => item.id)).toEqual(["task:krk-812"]);
    expect(places.at(-1)?.id).toBe("unassign");
  });

  it("offers removing a task only to those the hub lets remove it", () => {
    const ids = (removable: boolean) =>
      taskMenuItems({ task: { ...split!, removable }, canStartThread: false }).map((i) => i.id);
    expect(ids(true)).toContain("remove");
    expect(ids(false)).not.toContain("remove");
    expect(ids(false)).toContain("rename");
  });
});

describe("menus of durable work", () => {
  it("offers only Move for our thread whose runtime is gone", () => {
    const base = kirkwood();
    const hub = status(base);
    const project = {
      ...base,
      work: {
        ...base.work,
        threads: [
          {
            id: "herdr:codex:gone",
            task: "krk-812",
            title: "Awaiting merge",
            email: hub.email!,
            environment: HERE,
            status: "working" as const,
            source: "herdr" as const,
            runtimePresent: false,
            observable: true,
            seenAt: new Date(NOW).toISOString(),
            delivery: "review" as const,
          },
        ],
      },
    };
    const s = status(project);
    const [tree] = buildWorkTree({
      status: { ...s, agents: { ...s.agents, list: [] } },
      localThreads: [],
      now: NOW,
    });
    const task = tree!.areas[0]!.tasks[0]!;
    expect(
      threadMenuItems({
        thread: task.threads[0]!,
        taskId: task.id,
        tasks: project.work.tasks,
        running: false,
      }).map((item) => item.id),
    ).toEqual(["move"]);
  });
});
