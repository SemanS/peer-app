import {
  PEER_LOCAL_WORKSPACE,
  EnvironmentId,
  ProjectId,
  ThreadId,
  type PeerHubStatus,
  type PeerOwnerCall,
  type PeerProjectState,
  type PeerTask,
} from "@t3tools/contracts";
import { needsYouKey, needsYouPushId, settleHandover } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "../state/models.ts";
import { describe, expect, it } from "@effect/vitest";
import {
  activeAgents,
  deriveNeedsYou,
  focusItem,
  overlapTopic,
  type NeedsYouEnvironment,
} from "./needsYou.ts";

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

const OTHER = EnvironmentId.make("env-other");
const environment = (
  snapshot: PeerHubStatus,
  extra: Partial<NeedsYouEnvironment> = {},
): NeedsYouEnvironment => ({
  environmentId: HERE,
  label: "Laptop",
  connected: true,
  status: snapshot,
  threads: [],
  ...extra,
});
const request = (
  id = "r1",
  extra: Partial<NonNullable<PeerHubStatus["requests"]>[number]["request"]> = {},
) => ({
  id,
  project: "kirkwood",
  task: "krk-812",
  sender: "yev@acme.test",
  recipient: "slavo@acme.test",
  title: "Check payment",
  prompt: "Please inspect it",
  status: "pending" as const,
  createdAt: "2026-10-03T10:00:00Z",
  updatedAt: "2026-10-03T10:00:00Z",
  ...extra,
});
function attentionStatus(): PeerHubStatus {
  const base = status(kirkwood());
  return {
    ...base,
    agents: {
      ...base.agents,
      list: [{ id: "herdr:claude:local", paneId: "p", title: "Finished work", status: "done" }],
    },
    requests: [{ workspace: "acme", request: request() }],
    coordination: {
      ...base.coordination,
      enabled: true,
      sessions: [
        {
          id: "claude:local",
          workspace: "acme",
          project: "kirkwood",
          email: base.email!,
          label: "Coding",
          status: "working",
          task: "krk-812",
          files: [],
          claims: [],
          local: true,
        },
      ],
      overlaps: [
        {
          id: "o",
          workspace: "acme",
          project: "kirkwood",
          sessions: ["claude:local"],
          files: ["task:krk-812"],
          state: "open",
          notes: [],
          updatedAt: "2026-10-03T11:55:00Z",
          policy: "ask",
        },
      ],
    },
    needsYou: {
      alerts: { enabled: false, delivery: "not-linked" },
      staleInputs: [
        {
          session: "claude:local",
          since: "2026-10-03T11:55:00Z",
          scopes: [{ scope: "task:str", readVersion: 1, currentVersion: null }],
        },
      ],
    },
  };
}
const derive = (environments: ReadonlyArray<NeedsYouEnvironment>) =>
  deriveNeedsYou({ environments, now: NOW, unseen: (thread) => thread.settledAt !== null });
describe("Needs you across computers", () => {
  it("keeps local decisions actionable when signed out or the optional Hub is offline", () => {
    for (const signedIn of [false, true]) {
      const base = attentionStatus();
      const snapshot: PeerHubStatus = {
        ...base,
        signedIn,
        email: signedIn ? base.email : null,
        error: "Hub unreachable",
        workspaces: [],
        requests: [],
        coordination: {
          ...base.coordination,
          sessions: base.coordination.sessions.map((s) => ({
            ...s,
            workspace: PEER_LOCAL_WORKSPACE,
            email: "local",
          })),
          overlaps: base.coordination.overlaps.map((o) => ({
            ...o,
            workspace: PEER_LOCAL_WORKSPACE,
          })),
        },
      };
      const item = derive([environment(snapshot)]).find((item) => item.kind === "overlap");
      expect(item).toMatchObject({
        kind: "overlap",
        hubError: false,
        participants: ["You"],
        computers: [{ blocker: null }],
      });
    }
  });

  it("orders approval, input, request, overlap, stale inputs, completion", () => {
    const items = derive([
      environment(attentionStatus(), {
        threads: [
          shell("approval", "Approval", { hasPendingApprovals: true }),
          shell("input", "Input", { hasPendingUserInput: true }),
        ],
      }),
    ]);
    expect(items.map((item) => item.kind)).toEqual([
      "thread",
      "thread",
      "request",
      "overlap",
      "stale",
      "agent",
    ]);
    expect(items.map((item) => item.rank)).toEqual([0, 1, 2, 3, 4, 5]);
    const stale = items.find((item) => item.kind === "stale");
    expect(stale?.kind === "stale" && stale.stale.scopes[0]?.currentVersion).toBeNull();
  });
  it("de-duplicates a request and keeps each computer's launch blocker", () => {
    const snapshot = attentionStatus();
    const unavailable = {
      ...snapshot,
      agents: { ...snapshot.agents, herdr: "not-running" as const },
    };
    const items = derive([
      environment(snapshot),
      environment(unavailable, { environmentId: OTHER, label: "Desktop" }),
    ]);
    const requests = items.filter((item) => item.kind === "request");
    expect(requests).toHaveLength(1);
    expect(
      requests[0]?.kind === "request" &&
        requests[0].computers.map((computer) => [computer.label, computer.blocker === null]),
    ).toEqual([
      ["Desktop", false],
      ["Laptop", true],
    ]);
  });
  it("excludes other recipients, handled requests and signed-out environments", () => {
    const snapshot = {
      ...attentionStatus(),
      requests: [
        request("other", { recipient: "other@acme.test" }),
        request("accepted", { status: "accepted" }),
        request("dismissed", { status: "dismissed" }),
      ].map((request) => ({ workspace: "acme", request })),
    };
    expect(derive([environment(snapshot)]).filter((item) => item.kind === "request")).toHaveLength(
      0,
    );
    expect(
      derive([environment({ ...attentionStatus(), signedIn: false })]).filter(
        (item) => item.kind === "request",
      ),
    ).toHaveLength(0);
  });
  it("excludes archived and deleted local threads", () => {
    const items = derive([
      environment(status(kirkwood()), {
        threads: [
          shell("archived", "old", {
            hasPendingApprovals: true,
            archivedAt: "2026-10-02T00:00:00Z",
          }),
          shell("deleted", "old", { hasPendingUserInput: true, deletedAt: "2026-10-02T00:00:00Z" }),
        ],
      }),
    ]);
    expect(items.filter((item) => item.kind === "thread")).toHaveLength(0);
  });
  it("shows only decide or unanswered overlaps of the signed-in person's sessions", () => {
    const snapshot = attentionStatus();
    expect(derive([environment(snapshot)]).filter((item) => item.kind === "overlap")).toHaveLength(
      1,
    );
    for (const coordination of [
      { ...snapshot.coordination, enabled: false },
      { ...snapshot.coordination, sessions: [] },
      {
        ...snapshot.coordination,
        overlaps: snapshot.coordination.overlaps.map((overlap) => ({
          ...overlap,
          policy: "notify",
        })),
      },
      {
        ...snapshot.coordination,
        overlaps: snapshot.coordination.overlaps.map((overlap) => ({
          ...overlap,
          askedAt: "2026-10-03T11:59:00Z",
        })),
      },
    ])
      expect(
        derive([environment({ ...snapshot, coordination })]).filter(
          (item) => item.kind === "overlap",
        ),
      ).toHaveLength(0);
    const unanswered = {
      ...snapshot,
      coordination: {
        ...snapshot.coordination,
        overlaps: snapshot.coordination.overlaps.map((overlap) => ({
          ...overlap,
          policy: "notify",
          askedAt: "2026-10-03T11:57:00Z",
        })),
      },
    };
    expect(
      derive([environment(unanswered)]).some(
        (item) => item.kind === "overlap" && item.phase === "unanswered",
      ),
    ).toBe(true);
  });
  it("lists an overlap whose agents ended as the person's to close, with no wait", () => {
    const snapshot = attentionStatus();
    const email = snapshot.email!;
    const recent = snapshot.coordination.overlaps.map((overlap) => ({
      ...overlap,
      policy: "notify",
      updatedAt: "2026-10-03T11:59:30Z",
      notes: [
        {
          id: "n1",
          session: "claude:local",
          email,
          text: "I keep my version.",
          at: "2026-10-03T11:59:30Z",
        },
      ],
    }));
    const overlaps = (coordination: PeerHubStatus["coordination"]) =>
      derive([environment({ ...snapshot, coordination })]).filter(
        (item) => item.kind === "overlap",
      );
    // While its agent is at work and the overlap is fresh, nothing waits on the person.
    expect(overlaps({ ...snapshot.coordination, overlaps: recent })).toHaveLength(0);
    // Both sides gone: the person's part shows in their agent's note.
    expect(overlaps({ ...snapshot.coordination, sessions: [], overlaps: recent })).toMatchObject([
      { phase: "decide", reason: "gone", participants: ["Slavo"] },
    ]);
    // A handover note no agent wrote after, while the session still shows at work.
    const handedOver = recent.map((overlap) => ({
      ...overlap,
      notes: [
        ...overlap.notes,
        {
          id: "n2",
          email,
          text: settleHandover({ agent: "Coding", reason: "off" }),
          at: "2026-10-03T11:59:40Z",
        },
      ],
    }));
    expect(overlaps({ ...snapshot.coordination, overlaps: handedOver })).toMatchObject([
      { phase: "decide", reason: "handover" },
    ]);
  });
  it("retains offline items and flags the Hub error and handled alert", () => {
    const items = derive([
      environment({ ...attentionStatus(), error: "unreachable" }, { connected: false }),
    ]);
    expect(items.every((item) => item.offline)).toBe(true);
    expect(
      items
        .filter((item) => item.kind === "request" || item.kind === "overlap")
        .every((item) => item.hubError),
    ).toBe(true);
    const id = needsYouPushId(needsYouKey.request("acme", "r1"))!;
    expect(focusItem(items, id)?.kind).toBe("request");
    expect(focusItem(items, "peer-needs-you.request.0000000000000000")).toBeNull();
  });
  it("breaks equal ranks and titles by the stable item key", () => {
    const snapshot = {
      ...status(kirkwood()),
      agents: { herdr: "running" as const, list: [] },
      requests: [request("b"), request("a")].map((request) => ({ workspace: "acme", request })),
    };
    expect(derive([environment(snapshot)]).map((item) => item.key)).toEqual([
      needsYouKey.request("acme", "a"),
      needsYouKey.request("acme", "b"),
    ]);
  });
});

describe("Needs you: owner's calls", () => {
  const SLAVO = "slavo@acme.test";
  const YEV = "yev@acme.test";
  const CHINO = "chino@acme.test";
  const DAN = "dan@acme.test";
  const ownerCall = (id = "oc-1", extra: Partial<PeerOwnerCall> = {}): PeerOwnerCall => ({
    id,
    project: "kirkwood",
    task: "krk-812",
    session: "claude:y1",
    email: YEV,
    environment: "yev-laptop",
    owner: SLAVO,
    paths: ["src/payments/fees.ts"],
    reason: "add a refund fee field",
    state: "pending",
    onBehalf: false,
    createdAt: "2026-10-03T11:20:00Z",
    updatedAt: "2026-10-03T11:20:00Z",
    expiresAt: "2026-10-10T11:20:00Z",
    ...extra,
  });
  /** Kirkwood's ownership as the Hub last said it: `calls`, and who leads. */
  function withCalls(
    calls: ReadonlyArray<PeerOwnerCall>,
    options: { readonly leads?: ReadonlyArray<string>; readonly project?: string } = {},
  ): PeerHubStatus {
    return {
      ...status(kirkwood()),
      ownership: {
        projects: [
          {
            workspace: "acme",
            project: options.project ?? "kirkwood",
            at: "2026-10-03T11:59:00Z",
            leads: options.leads ?? [SLAVO],
            map: { version: 1, areas: {}, paths: {}, decide: [] },
            tasks: {},
            calls,
          },
        ],
      },
    };
  }
  const calls = (snapshot: PeerHubStatus, extra: Partial<NeedsYouEnvironment> = {}) =>
    derive([environment(snapshot, extra)]).filter((item) => item.kind === "owner-call");

  it("asks the owner of the path, in the card's words, once the Hub says so", () => {
    const [item] = calls(withCalls([ownerCall()]));
    expect(item).toMatchObject({
      key: needsYouKey.ownerCall("acme", "kirkwood", "oc-1"),
      title: "Yev's agent asks to change your path",
      rank: 2,
      since: "2026-10-03T11:20:00Z",
      workspace: "acme",
      project: "kirkwood",
      asker: "Yev",
      owner: "Slavo",
      onBehalf: false,
      offline: false,
    });
    expect(item?.kind === "owner-call" && item.call.paths).toEqual(["src/payments/fees.ts"]);
    // A phone alert for it is a follow-up: the key makes no push id yet.
    expect(needsYouPushId(item!.key)).toBeNull();
  });

  it("asks a lead for the calls of an owner who left, and says it is on the owner's behalf", () => {
    const orphaned = withCalls([ownerCall("oc-2", { owner: DAN })]);
    const [item] = calls(orphaned);
    expect(item).toMatchObject({
      title: "Yev's agent asks Dan to change their path",
      owner: "Dan",
      onBehalf: true,
    });
    // Nobody who does not lead the project is asked for them.
    expect(calls(withCalls([ownerCall("oc-2", { owner: DAN })], { leads: [] }))).toHaveLength(0);
  });

  it("leaves out another owner's call, one the person's own agent opened, and one no longer open", () => {
    const left = [
      ownerCall("a", { owner: CHINO }),
      ownerCall("b", { email: SLAVO, owner: DAN }),
      ...["accepted", "declined", "withdrawn", "expired"].map((state) =>
        ownerCall(`s-${state}`, { state }),
      ),
      // Pending when the Hub made its view, but past its expiry by now.
      ownerCall("lapsed", { expiresAt: "2026-10-03T11:59:00Z" }),
    ];
    expect(calls(withCalls(left))).toHaveLength(0);
  });

  it("is one item however many computers of the person read it", () => {
    const snapshot = withCalls([ownerCall()]);
    const both = derive([
      environment(snapshot),
      environment(snapshot, { environmentId: OTHER, label: "Desktop", connected: false }),
    ]).filter((item) => item.kind === "owner-call");
    expect(both).toHaveLength(1);
    expect(both[0]?.offline).toBe(false);
    const away = derive([
      environment(snapshot, { connected: false }),
      environment(snapshot, { environmentId: OTHER, label: "Desktop", connected: false }),
    ]).filter((item) => item.kind === "owner-call");
    expect(away.map((item) => item.offline)).toEqual([true]);
  });

  it("is absent while signed out, without ownership, or for a project this computer does not have", () => {
    expect(calls({ ...withCalls([ownerCall()]), signedIn: false })).toHaveLength(0);
    expect(calls(status(kirkwood()))).toHaveLength(0);
    expect(calls(withCalls([ownerCall()], { project: "booking" }))).toHaveLength(0);
  });

  it("comes after what waits on the person's own agents, and sorts with requests by age", () => {
    const snapshot = {
      ...withCalls([ownerCall("late")]),
      agents: { herdr: "running" as const, list: [] },
      requests: [{ workspace: "acme", request: request("r1") }],
    };
    const items = derive([
      environment(snapshot, {
        threads: [shell("approval", "Approval", { hasPendingApprovals: true })],
      }),
    ]);
    expect(items.map((item) => item.kind)).toEqual(["thread", "request", "owner-call"]);
    expect(items.map((item) => item.rank)).toEqual([0, 2, 2]);
  });
});

it("names leased resources and patterns without treating them as files", () => {
  const snapshot = attentionStatus();
  const overlap = snapshot.coordination!.overlaps[0]!;
  expect(
    overlapTopic(snapshot, {
      ...overlap,
      files: ["resource:deploy", "pattern:migrations/**", "src/a.ts"],
    }),
  ).toBe("Resource deploy · Pattern migrations/** · src/a.ts");
});
