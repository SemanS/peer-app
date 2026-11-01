import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type PeerHubStatus,
  type PeerProjectState,
  type PeerTask,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "../state/models.ts";
import { describe, expect, it } from "@effect/vitest";
import { activeAgents } from "./needsYou.ts";

const HERE = EnvironmentId.make("env-here");
const KIRKWOOD_T3 = ProjectId.make("t3-kirkwood");

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
      tools: [],
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
        memberName: "Slavo",
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
    coordination: {
      enabled: false,
      policy: "coordinate",
      claudeHooks: false,
      logPath: "",
      sessions: [],
      overlaps: [],
      findings: [],
      contexts: [],
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

describe("activeAgents", () => {
  it("puts what waits on you first, and keeps what just works below it", () => {
    const finished = shell("t5", "Webhook retries", {
      latestRun: { completedAt: "2026-10-03T11:00:00Z" },
    } as Partial<EnvironmentThreadShell>);
    const project = status(kirkwood());
    const withDone = {
      ...project,
      agents: {
        ...project.agents,
        list: [
          ...project.agents.list,
          {
            id: "herdr:term3",
            paneId: "w3:p1",
            agent: "claude",
            title: "Review the diff",
            status: "done" as const,
          },
        ],
      },
    };
    const agents = activeAgents({
      status: withDone,
      localThreads: [...LOCAL, finished],
      projectNames: new Map([[`${HERE}:${KIRKWOOD_T3}`, "Kirkwood"]]),
      localEnvironmentId: HERE,
      unseen: (thread) => thread.id === finished.id,
      taskOf: new Map([["herdr:term1", "KRK-812 · Split Payments"]]),
    });
    expect(agents.map((a) => [a.title, a.needs ?? a.status, a.where])).toEqual([
      ["Investigation for KRK-812", "input", "Kirkwood · KRK-812 · Split Payments"],
      ["Review the diff", "review", undefined],
      ["Webhook retries", "review", "Kirkwood"],
      ["Main implementation", "working", "Kirkwood"],
      ["Side project", "working", "side"],
    ]);
  });
});
