import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type PeerFindingDecision,
  type PeerHubStatus,
  type PeerProjectState,
  type PeerTask,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentThreadShell } from "../state/models.ts";
import {
  adviceLabel,
  adviceOnWork,
  buildWorkTree,
  childrenOf,
  harnessName,
  scopeItems,
  scopeOfArea,
  scopeOfTask,
  scopePrompt,
  subtreeOf,
  taskNamedIn,
} from "./work.ts";

const HERE = EnvironmentId.make("env-here");
const KIRKWOOD_T3 = ProjectId.make("t3-kirkwood");
const NOW = Date.parse("2026-10-03T12:00:00Z");
const NOW_ISO = "2026-10-03T12:00:00.000Z";

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
      assignments: { "peer:t2": "partner-rec" },
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

describe("buildWorkTree", () => {
  it("follows the product: project → area → task → threads, people as metadata", () => {
    const [project] = buildWorkTree({ status: status(kirkwood()), localThreads: LOCAL, now: NOW });
    expect(project?.name).toBe("Kirkwood");
    expect(project?.areas.map((a) => a.name)).toEqual([
      "Groups & Events",
      "Revenue",
      "Infrastructure",
      null,
    ]);
    const split = project?.areas[0]?.tasks[0];
    expect(split?.key).toBe("KRK-812");
    // A herdr agent naming the key, a branch naming it, and a colleague's thread placed on it.
    expect(split?.threads.map((t) => [t.title, t.person, t.status])).toEqual([
      ["Investigation for KRK-812", "Slavo", "blocked"],
      ["Main implementation", "Slavo", "working"],
      ["UI adjustments", "Yev", "working"],
    ]);
    expect(split?.status).toBe("blocked");
    const partnerRec = project?.areas[1]?.tasks[0];
    expect(partnerRec?.threads.map((t) => [t.title, t.status])).toEqual([
      ["Consolidated average", "done"],
    ]);
    expect(partnerRec?.status).toBe("idle"); // A settled runtime does not prove delivery.
    const str = project?.areas[1]?.tasks[1];
    expect(str?.threads[0]?.stale).toBe(true);
    expect(project?.unsorted.map((t) => t.title)).toEqual(["Tidy the README"]);
  });

  it("opens this computer's threads and herdr agents, and only those can be placed", () => {
    const [project] = buildWorkTree({ status: status(kirkwood()), localThreads: LOCAL, now: NOW });
    const threads = project?.areas[0]?.tasks[0]?.threads ?? [];
    expect(threads.find((t) => t.source === "herdr")?.open).toEqual({
      kind: "herdr",
      agentId: "herdr:term1",
      paneId: "w1:p2",
    });
    expect(threads.find((t) => t.title === "Main implementation")?.open).toEqual({
      kind: "thread",
      environmentId: HERE,
      threadId: ThreadId.make("t1"),
    });
    expect(threads.find((t) => t.person === "Yev")?.placeable).toBe(false);
  });

  it("carries each thread's version control, and the project's from its checkouts here", () => {
    const base = kirkwood();
    const jj: PeerProjectState = {
      ...base,
      repositories: base.repositories.map((repo) => ({ ...repo, vcs: "jj" as const })),
      work: {
        ...base.work,
        threads: base.work.threads.map((thread) =>
          thread.email === "yev@acme.test" ? { ...thread, vcs: "jj" as const } : thread,
        ),
      },
    };
    const [project] = buildWorkTree({ status: status(jj), localThreads: LOCAL, now: NOW });
    expect(project?.vcs).toBe("jj");
    const threads = project?.areas[0]?.tasks[0]?.threads ?? [];
    // Yev's report says jj; the local thread takes its checkout's; Chino's says nothing, so Git.
    expect(threads.find((t) => t.person === "Yev")?.vcs).toBe("jj");
    expect(threads.find((t) => t.title === "Main implementation")?.vcs).toBe("jj");
    expect(project?.areas[1]?.tasks[1]?.threads[0]?.vcs).toBeUndefined();
    const [plain] = buildWorkTree({ status: status(kirkwood()), localThreads: LOCAL, now: NOW });
    expect(plain?.vcs).toBe("git");
  });

  it("opens a colleague's shared thread to watch only while watching is on", () => {
    const project = kirkwood();
    const shared = {
      ...project,
      work: {
        ...project.work,
        threads: project.work.threads.map((t) =>
          t.id === "peer:t9" ? { ...t, observable: true } : t,
        ),
      },
    };
    const theirs = (watch?: boolean) =>
      buildWorkTree({
        status: status(shared),
        localThreads: LOCAL,
        now: NOW,
        ...(watch === undefined ? {} : { watch }),
      })[0]?.areas[0]?.tasks[0]?.threads.find((t) => t.person === "Yev");
    expect(theirs()).toMatchObject({
      observable: true,
      open: { kind: "observe", environment: "yev-laptop", thread: "peer:t9" },
    });
    expect(theirs(false)).toMatchObject({ observable: false, open: undefined });
  });

  it("puts your own threads first, then what needs attention", () => {
    const project = kirkwood();
    const colleague = project.work.threads[0];
    const waiting = {
      ...colleague!,
      id: "peer:t10",
      title: "Payments review",
      email: "chino@acme.test",
      status: "blocked" as const,
    };
    const [tree] = buildWorkTree({
      status: status({ ...project, work: { ...project.work, threads: [colleague!, waiting] } }),
      localThreads: LOCAL,
      now: NOW,
    });
    expect(tree?.areas[0]?.tasks[0]?.threads.map((t) => [t.person, t.status])).toEqual([
      ["Slavo", "blocked"],
      ["Slavo", "working"],
      ["Chino", "blocked"],
      ["Yev", "working"],
    ]);
  });

  it("lets the task's creator, a lead or an admin remove it, as the hub does", () => {
    const project = kirkwood();
    const asMember = {
      ...project,
      project: { ...project.project, role: "member" as const },
      work: {
        ...project.work,
        tasks: [
          { ...task("mine", "Mine", "Revenue"), createdBy: "slavo@acme.test" },
          { ...task("theirs", "Theirs", "Revenue"), createdBy: "yev@acme.test" },
        ],
      },
    };
    const removable = (role: "owner" | "member") =>
      buildWorkTree({ status: status(asMember, role), localThreads: [], now: NOW })[0]
        ?.areas.flatMap((a) => a.tasks)
        .map((t) => [t.id, t.removable]);
    expect(removable("member")).toEqual([
      ["mine", true],
      ["theirs", false],
    ]);
    expect(removable("owner")).toEqual([
      ["mine", true],
      ["theirs", true],
    ]);
  });
});

describe("shared contexts", () => {
  const session = (id: string, email: string) => ({
    id,
    workspace: "acme",
    project: "kirkwood",
    email,
    label: "work",
    status: "working" as const,
    files: ["src/pay.ts"],
    claims: [],
    local: email === "slavo@acme.test",
  });

  it("gives a task its context: who keeps it while at work, and the findings its keeper has not decided", () => {
    const project = kirkwood();
    const yevAgent = {
      id: "herdr:claude:s-yev",
      task: "krk-812",
      title: "Webhook retries",
      email: "yev@acme.test",
      status: "working" as const,
      source: "herdr" as const,
      environment: "yev-laptop",
      seenAt: "2026-10-03T11:59:30Z",
    };
    const base = status({
      ...project,
      work: { ...project.work, threads: [...project.work.threads, yevAgent] },
    });
    const finding = (
      id: string,
      text: string,
      at: string,
      task?: string,
      decision?: PeerFindingDecision,
    ) => ({
      id,
      ...(decision === undefined ? {} : { decision }),
      workspace: "acme",
      project: "kirkwood",
      ...(task === undefined ? {} : { task }),
      text,
      email: "chino@acme.test",
      at,
    });
    const keeper = (session: string, email: string) => ({
      session,
      email,
      environment: "laptop",
      since: "2026-10-03T10:00:00Z",
    });
    const [tree] = buildWorkTree({
      status: {
        ...base,
        coordination: {
          ...base.coordination,
          sessions: [session("claude:s-yev", "yev@acme.test")],
          findings: [
            finding("f1", "Stripe retries webhooks for 3 days", "2026-10-03T11:50:00Z", "krk-812"),
            // Older than version 4, yet its keeper never decided it: it still waits.
            finding("f2", "Left out of version 4", "2026-10-03T11:00:00Z", "krk-812"),
            finding("f4", "Folded in already", "2026-10-03T11:52:00Z", "krk-812", {
              status: "incorporated",
              reason: "in Provides",
              actor: "yev@acme.test",
              contextScope: "task:krk-812",
              contextVersion: 4,
              at: "2026-10-03T11:53:00Z",
            }),
            finding("f3", "Work outside tasks", "2026-10-03T11:55:00Z"),
          ],
          contexts: [
            {
              workspace: "acme",
              project: "kirkwood",
              scope: "task:krk-812",
              version: 4,
              keeper: keeper("claude:s-yev", "yev@acme.test"),
              updatedAt: "2026-10-03T11:30:00Z",
              updatedBy: "yev@acme.test",
              updatedSession: "claude:s-yev",
              gist: "Stripe webhooks retry; we dedupe by event id",
              bytes: 8_400,
            },
            {
              workspace: "acme",
              project: "kirkwood",
              scope: "project",
              version: 0,
              keeper: keeper("claude:ended", "chino@acme.test"),
              updatedAt: "2026-10-03T09:00:00Z",
              bytes: 0,
            },
          ],
        },
      },
      localThreads: LOCAL,
      now: NOW,
    });
    const task = tree?.areas[0]?.tasks[0];
    expect([task?.id, task?.context?.keeper?.person, task?.context?.updatedBy]).toEqual([
      "krk-812",
      "Yev",
      "Yev",
    ]);
    expect([task?.context?.gist, task?.context?.tokens]).toEqual([
      "Stripe webhooks retry; we dedupe by event id",
      2_100,
    ]);
    expect(task?.threads.filter((t) => t.keepsContext).map((t) => t.title)).toEqual([
      "Webhook retries",
    ]);
    expect(task?.context?.reports.map((r) => r.text)).toEqual([
      "Stripe retries webhooks for 3 days",
      "Left out of version 4",
    ]);
    expect(tree?.context?.keeper).toBeUndefined();
    expect(tree?.context?.reports.map((r) => r.text)).toEqual(["Work outside tasks"]);
    expect(tree?.areas[0]?.tasks[1]?.context).toBeUndefined();
  });

  it("says why a colleague's thread concerns you", () => {
    const project = kirkwood();
    const yevAgent = {
      id: "herdr:claude:s-yev",
      task: "krk-812",
      title: "Pay form validation",
      email: "yev@acme.test",
      status: "working" as const,
      source: "herdr" as const,
      environment: "yev-laptop",
      seenAt: "2026-10-03T11:59:30Z",
    };
    const base = status({
      ...project,
      work: { ...project.work, threads: [...project.work.threads, yevAgent] },
    });
    const [tree] = buildWorkTree({
      status: {
        ...base,
        coordination: {
          ...base.coordination,
          sessions: [
            session("claude:s-me", "slavo@acme.test"),
            session("claude:s-yev", "yev@acme.test"),
          ],
          overlaps: [
            {
              id: "o1",
              workspace: "acme",
              project: "kirkwood",
              sessions: ["claude:s-me", "claude:s-yev"],
              files: ["src/pay.ts"],
              state: "open" as const,
              notes: [],
              updatedAt: "2026-10-03T11:59:00Z",
            },
          ],
        },
      },
      localThreads: LOCAL,
      now: NOW,
    });
    const threads = tree?.areas[0]?.tasks[0]?.threads ?? [];
    expect(threads.find((t) => t.title === "Pay form validation")?.concerns).toBe(
      "Its agent and yours both change src/pay.ts",
    );
    expect(threads.find((t) => t.title === "UI adjustments")?.concerns).toBeUndefined();
  });
});

describe("taskNamedIn", () => {
  const tasks = [task("krk-812", "Split", "A", "KRK-812"), task("krk-81", "Rec", "A", "KRK-81")];
  it("matches a key as a whole token, never two at once", () => {
    expect(taskNamedIn(tasks, ["feature/krk-812-split"])?.id).toBe("krk-812");
    expect(taskNamedIn(tasks, ["Fix KRK-81 totals"])?.id).toBe("krk-81");
    expect(taskNamedIn(tasks, ["KRK-8120"])).toBeUndefined();
    expect(taskNamedIn(tasks, ["KRK-81 and KRK-812"])).toBeUndefined();
  });
});

describe("what an agent did with the team's work", () => {
  const told = (
    over: Partial<NonNullable<PeerHubStatus["coordination"]["advice"]>[number]> = {},
  ): NonNullable<PeerHubStatus["coordination"]["advice"]>[number] => ({
    workspace: "acme",
    project: "kirkwood",
    session: "claude:a",
    about: "work",
    scope: "task:str",
    name: "STR",
    how: "read",
    why: "read its shared context, version 3",
    at: "2026-10-03T11:55:00Z",
    ...over,
  });
  const withAdvice = (advice: ReadonlyArray<ReturnType<typeof told>>): PeerHubStatus => {
    const base = status(kirkwood());
    return {
      ...base,
      coordination: {
        ...base.coordination,
        sessions: [
          {
            id: "claude:a",
            workspace: "acme",
            project: "kirkwood",
            email: "slavo@acme.test",
            label: "Split payments",
            status: "working",
            task: "krk-812",
            files: [],
            claims: [],
            local: true,
          },
          {
            id: "codex:b",
            workspace: "acme",
            project: "kirkwood",
            email: "yev@acme.test",
            label: "UI",
            status: "working",
            task: "krk-812",
            files: [],
            claims: [],
            local: false,
          },
          {
            id: "claude:c",
            workspace: "acme",
            project: "kirkwood",
            email: "chino@acme.test",
            label: "Loose",
            status: "working",
            files: [],
            claims: [],
            local: false,
          },
        ],
        advice,
      },
    };
  };
  const on = (status: PeerHubStatus, scope: string) =>
    adviceOnWork({ status, workspace: "acme", project: "kirkwood", scope });

  it("is listed on the work its agent is on, newest first, with whose agent it was", () => {
    const status = withAdvice([
      told({ at: "2026-10-03T11:50:00Z", name: "Partner Rec", scope: "task:partner-rec" }),
      told({ at: "2026-10-03T11:58:00Z", session: "codex:b", how: "asked" }),
      told({ session: "claude:c", name: "Loose ends" }),
    ]);
    const rows = on(status, "task:krk-812");
    expect(rows.map((row) => [row.person, row.name, row.mine])).toEqual([
      ["Yev", "STR", false],
      ["Slavo", "Partner Rec", true],
    ]);
    // An agent on no task is the project's work.
    expect(on(status, "project").map((row) => row.name)).toEqual(["Loose ends"]);
    expect(on(status, "task:str")).toEqual([]);
  });

  it("leaves out an agent that no longer reports, other projects and other workspaces", () => {
    const status = withAdvice([
      told({ session: "claude:gone" }),
      told({ project: "elsewhere" }),
      told({ workspace: "globex" }),
    ]);
    expect(on(status, "task:krk-812")).toEqual([]);
    // A Peer from before advice lists none.
    const base = withAdvice([]);
    const { advice: _gone, ...coordination } = base.coordination;
    expect(on({ ...base, coordination }, "task:krk-812")).toEqual([]);
  });

  it("says in a line whose agent did what", () => {
    const row = (over: Parameters<typeof told>[0]) => {
      const rows = on(withAdvice([told({ session: "codex:b", ...over })]), "task:krk-812");
      return adviceLabel(rows[0]!);
    };
    expect(row({})).toBe("Yev’s agent read this work’s context");
    expect(row({ how: "asked" })).toBe("Yev’s agent asked this work’s agents");
    expect(row({ how: "found" })).toBe("Yev’s agent was pointed to this work by a model it asked");
    expect(row({ about: "knowledge", scope: "kx:d1", entryKind: "decision", how: "read" })).toBe(
      "Yev’s agent read a decision of the project",
    );
    expect(row({ about: "knowledge", scope: "kx:d1", entryKind: "decision", how: "governs" })).toBe(
      "Yev’s agent was reminded of a decision of the project that governs files it changes",
    );
    expect(row({ about: "knowledge", scope: "kx:d1", how: "found" })).toBe(
      "Yev’s agent was pointed to an entry of the project by a model it asked",
    );
    const mine = on(withAdvice([told({})]), "task:krk-812");
    expect(adviceLabel(mine[0]!)).toBe("Your agent read this work’s context");
  });
});

describe("durable work and runtime presence", () => {
  it("overlays a live local thread on its hub record without duplicating it", () => {
    const base = kirkwood();
    const hub = status(base);
    const record = {
      id: "peer:local",
      task: "krk-812",
      title: "Build",
      email: hub.email!,
      environment: HERE,
      status: "idle" as const,
      source: "peer" as const,
      seenAt: NOW_ISO,
      runtimePresent: true,
      delivery: "review" as const,
    };
    const project = { ...base, work: { ...base.work, threads: [record] } };
    const [tree] = buildWorkTree({
      status: status(project),
      localThreads: [shell("local", "Build", { branch: "fix/KRK-812" })],
      now: NOW,
    });
    const nodes = tree!.areas.flatMap((area) => area.tasks).flatMap((task) => task.threads);
    expect(nodes.filter((node) => node.title === "Build")).toHaveLength(1);
    expect(nodes.find((node) => node.title === "Build")?.delivery).toBe("review");
  });

  it("keeps our absent runtime visible without an Observe action or a working task rollup", () => {
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
            seenAt: NOW_ISO,
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
    expect(task.threads[0]?.stale).toBe(true);
    expect(task.threads[0]?.open).toBeUndefined();
    expect(task.threads[0]?.status).toBe("unknown");
    expect(task.status).toBe("idle");
    expect(task.threads[0]?.key).toBe("herdr:codex:gone");
  });

  it("overlays a temporary herdr identity without duplicating its stable work", () => {
    const base = kirkwood();
    const hub = status(base);
    const record = {
      id: "herdr:codex:stable",
      previousId: "herdr:term1",
      task: "krk-812",
      title: "Investigation for KRK-812",
      email: hub.email!,
      environment: HERE,
      status: "idle" as const,
      source: "herdr" as const,
      runtimePresent: true,
      seenAt: NOW_ISO,
      delivery: "review" as const,
    };
    const project = { ...base, work: { ...base.work, threads: [record] } };
    const [tree] = buildWorkTree({ status: status(project), localThreads: [], now: NOW });
    const rows = tree!.areas.flatMap((area) => area.tasks).flatMap((task) => task.threads);
    expect(rows.filter((node) => node.title === record.title)).toHaveLength(1);
    expect(rows.find((node) => node.title === record.title)?.key).toBe(record.id);
  });
});

describe("harnessName", () => {
  it("names the harnesses the Threads list knows, and capitalises the rest", () => {
    expect(harnessName("claude")).toBe("Claude");
    expect(harnessName("Claude-Code")).toBe("Claude");
    expect(harnessName("codex")).toBe("Codex");
    expect(harnessName("opencode")).toBe("OpenCode");
    expect(harnessName("pi")).toBe("Pi");
    expect(harnessName(undefined)).toBeUndefined();
    expect(harnessName("  ")).toBeUndefined();
  });
});

describe("the task tree", () => {
  const item = (
    id: string,
    title: string,
    fields: Partial<PeerTask> & { readonly area?: string } = {},
  ): PeerTask => ({ ...task(id, title, fields.area), ...fields });
  const project = () => {
    const base = kirkwood();
    return {
      ...base,
      work: {
        ...base.work,
        areas: ["Revenue"],
        threads: [],
        assignments: {},
        tasks: [
          item("str", "STR", { area: "Revenue" }),
          // Listed before its parent, with an area of its own: it still shows under its root.
          item("routes", "Routes", { parent: "server", position: 1, area: "Elsewhere" }),
          item("change", "Add the tree", { area: "Revenue", kind: "group", executable: false }),
          item("server", "Server", {
            parent: "change",
            position: 2,
            executable: false,
            unsettled: true,
            progress: { done: 1, total: 2 },
          }),
          item("store", "Store", { parent: "server", position: 0, status: "done" }),
          item("docs", "Docs", { parent: "change", position: 3 }),
          item("api", "API", { parent: "change", position: 2, createdAt: "2026-09-30T00:00:00Z" }),
        ],
      },
    };
  };

  it("lists an area's tasks in tree order with their depth and place", () => {
    const [tree] = buildWorkTree({ status: status(project()), localThreads: [], now: NOW });
    expect(tree?.areas.map((area) => area.name)).toEqual(["Revenue"]);
    const revenue = tree!.areas[0]!;
    expect(revenue.tasks.map((node) => [node.id, node.depth, node.parent ?? null])).toEqual([
      ["str", 0, null],
      ["change", 0, null],
      ["api", 1, "change"],
      ["server", 1, "change"],
      ["store", 2, "server"],
      ["routes", 2, "server"],
      ["docs", 1, "change"],
    ]);
    const server = revenue.tasks.find((node) => node.id === "server");
    expect(server).toMatchObject({
      kind: "task",
      executable: false,
      unsettled: true,
      progress: { done: 1, total: 2 },
      childCount: 2,
    });
    expect(revenue.tasks.find((node) => node.id === "str")).toMatchObject({
      kind: "task",
      executable: true,
      unsettled: false,
      childCount: 0,
    });
    expect(childrenOf(revenue, "change").map((node) => node.id)).toEqual(["api", "server", "docs"]);
    expect(subtreeOf(revenue, "server").map((node) => node.id)).toEqual(["store", "routes"]);
    expect(scopeItems(revenue, "change").map((node) => node.id)).toEqual(["api", "routes", "docs"]);
    expect(scopeItems(tree!).map((node) => node.id)).toEqual(["str", "api", "routes", "docs"]);
  });

  it("keeps a task whose parent is missing or in a cycle as a root", () => {
    const base = project();
    const tasks = [
      item("a", "A", { parent: "b" }),
      item("b", "B", { parent: "a" }),
      item("orphan", "Orphan", { parent: "gone" }),
    ];
    const [tree] = buildWorkTree({
      status: status({ ...base, work: { ...base.work, areas: [], tasks } }),
      localThreads: [],
      now: NOW,
    });
    expect(tree?.areas.flatMap((area) => area.tasks).map((node) => [node.id, node.depth])).toEqual([
      ["a", 0],
      ["b", 0],
      ["orphan", 0],
    ]);
  });

  it("starts an agent on a task, a group's open items or an area's open tasks", () => {
    const [tree] = buildWorkTree({ status: status(project()), localThreads: [], now: NOW });
    const revenue = tree!.areas[0]!;
    const node = (id: string) => revenue.tasks.find((candidate) => candidate.id === id)!;
    expect(scopePrompt(scopeOfTask(tree!, node("docs")))).toBe(
      'Work on the Peer task "Docs" (docs).',
    );
    expect(scopePrompt(scopeOfTask(tree!, node("change")))).toBe(
      [
        'Work on the Peer group "Add the tree" (change) in Kirkwood: its open items, in order:',
        "- api API",
        "- routes Routes",
        "- docs Docs",
        "Mark each item done with peer task set <id> --status done as you finish it; peer done on the group finishes the group itself.",
      ].join("\n"),
    );
    expect(scopePrompt(scopeOfArea(tree!, revenue)).split("\n")[0]).toBe(
      'Work on the area "Revenue" of Kirkwood: its open tasks, in order:',
    );
    const many = Array.from({ length: 32 }, (_, index) => ({ id: `t${index}`, title: "T" }));
    const lines = scopePrompt({ kind: "area", name: null, project: "Kirkwood", items: many }).split(
      "\n",
    );
    expect(lines[0]).toBe(
      "Work on the tasks of Kirkwood without an area: its open tasks, in order:",
    );
    expect(lines.at(-2)).toBe("and 2 more");
    expect(lines).toHaveLength(33);
  });

  it("starts one agent on several scopes in order, with one closing instruction", () => {
    const [tree] = buildWorkTree({ status: status(project()), localThreads: [], now: NOW });
    const revenue = tree!.areas[0]!;
    const node = (id: string) => revenue.tasks.find((candidate) => candidate.id === id)!;
    const docs = scopeOfTask(tree!, node("docs"));
    expect(scopePrompt([docs])).toBe(scopePrompt(docs));
    expect(
      scopePrompt([
        scopeOfTask(tree!, node("str")),
        scopeOfTask(tree!, node("change")),
        scopeOfArea(tree!, revenue),
      ]),
    ).toBe(
      [
        "Work on these 3 Peer scopes in Kirkwood, in this order:",
        "",
        '1. Work on the Peer task "STR" (str).',
        "",
        [
          '2. Work on the Peer group "Add the tree" (change) in Kirkwood: its open items, in order:',
          "- api API",
          "- routes Routes",
          "- docs Docs",
        ].join("\n"),
        "",
        [
          '3. Work on the area "Revenue" of Kirkwood: its open tasks, in order:',
          "- str STR",
          "- api API",
          "- routes Routes",
          "- docs Docs",
        ].join("\n"),
        "",
        "Mark each item done with peer task set <id> --status done as you finish it; peer done finishes the scope you are on.",
      ].join("\n"),
    );
    expect(scopePrompt([docs, { kind: "task", id: "api", title: "API" }]).split("\n")[0]).toBe(
      "Work on these 2 Peer scopes, in this order:",
    );
  });
});
