import {
  EnvironmentId,
  type PeerCoordSession,
  type PeerHubStatus,
  type PeerOverlap,
  type PeerOwnerCall,
  type PeerOwnershipProject,
  type PeerTask,
  type PeerTaskOwner,
  type PeerWorkThread,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  TEAM_SIGNAL_AFTER_MS,
  agentsLine,
  buildTeamView,
  countAgents,
  decisionsWaitingOn,
  teamPersonWords,
  type TeamTask,
  type TeamView,
  memberLimits,
  onlyOnWords,
} from "./ownership.ts";
import { buildWorkTree } from "./work.ts";

// A project of five people, laid out as the design's Team page lays it out: Slavo (a lead, who is
// looking), Ana, Bob, Cyril and Eva.

const SLAVO = "slavo@acme.test";
const ANA = "ana@acme.test";
const BOB = "bob@acme.test";
const CYRIL = "cyril@acme.test";
const EVA = "eva@acme.test";
const NOW = Date.parse("2026-10-12T21:00:00Z");
const iso = (at: number) => DateTime.formatIso(DateTime.makeUnsafe(at));
const minutes = (count: number) => iso(NOW - count * 60_000);
const hours = (count: number) => minutes(count * 60);
const inDays = (count: number) => iso(NOW + count * 86_400_000);

const MEMBERS = [
  { email: SLAVO, name: "Slavo" },
  { email: ANA, name: "Ana" },
  { email: BOB, name: "Bob" },
  { email: CYRIL, name: "Cyril" },
  { email: EVA, name: "Eva" },
];

const hubTask = (
  id: string,
  title: string,
  extra: Partial<Omit<PeerTask, "id" | "title">> = {},
): PeerTask => ({
  id,
  key: id.toUpperCase(),
  title,
  status: "open",
  createdBy: ANA,
  createdAt: "2026-10-10T09:00:00Z",
  updatedAt: "2026-10-12T09:00:00Z",
  ...extra,
});

/** A chat as the Hub reports it. Its title is a secret: no view of the team may carry it. */
const chat = (
  id: string,
  task: string | undefined,
  email: string,
  status: PeerWorkThread["status"],
  extra: Partial<PeerWorkThread> = {},
): PeerWorkThread => ({
  id,
  ...(task === undefined ? {} : { task }),
  title: `SECRET title of chat ${id}`,
  email,
  status,
  source: "peer",
  environment: `${email}-laptop`,
  seenAt: minutes(0),
  ...extra,
});

const owner = (task: string, email: string, reason = "named"): PeerTaskOwner => ({
  project: "ordering",
  task,
  owner: email,
  since: hours(48),
  reason,
});

const call = (overrides: Partial<PeerOwnerCall> = {}): PeerOwnerCall => ({
  id: "oc-1",
  project: "ordering",
  task: "ord-9",
  session: "claude:b1",
  email: BOB,
  environment: "bob-laptop",
  owner: ANA,
  paths: ["src/payments/fees.ts"],
  reason: "add a refund fee field",
  state: "pending",
  onBehalf: false,
  createdAt: minutes(40),
  updatedAt: minutes(40),
  expiresAt: inDays(6),
  ...overrides,
});

const session = (
  id: string,
  email: string,
  task: string | undefined,
  overrides: Partial<PeerCoordSession> = {},
): PeerCoordSession => ({
  id,
  workspace: "acme",
  project: "ordering",
  email,
  environment: `${email}-laptop`,
  label: `SECRET label of session ${id}`,
  ...(task === undefined ? {} : { task }),
  status: "working",
  files: [],
  claims: [],
  local: false,
  activeAt: minutes(1),
  ...overrides,
});

const overlap = (overrides: Partial<PeerOverlap> = {}): PeerOverlap => ({
  id: "o1",
  workspace: "acme",
  project: "ordering",
  sessions: ["claude:s1", "claude:c1"],
  files: ["src/orders/notes.ts"],
  state: "open",
  notes: [],
  updatedAt: minutes(35),
  ...overrides,
});

interface Setup {
  readonly viewer?: string;
  readonly role?: "lead" | "member";
  readonly workspaceRole?: "owner" | "admin" | "member";
  readonly tasks?: ReadonlyArray<PeerTask>;
  readonly threads?: ReadonlyArray<PeerWorkThread>;
  readonly ownership?: Partial<PeerOwnershipProject> | null;
  readonly coordination?: boolean;
  readonly sessions?: ReadonlyArray<PeerCoordSession>;
  readonly overlaps?: ReadonlyArray<PeerOverlap>;
}

const TASKS = [
  hubTask("ord-9", "Refund fee field", { area: "Payments" }),
  hubTask("ord-11", "Receipt totals in cents", {
    area: "Payments",
    status: "review",
    updatedAt: hours(26),
  }),
  hubTask("ord-15", "Refund reasons", { area: "Payments" }),
  hubTask("ord-7", "Order notes header", { area: "Orders", status: "review", updatedAt: hours(2) }),
  hubTask("ord-12", "Menu photos", { area: "Menu" }),
  hubTask("ord-14", "Checkout copy"),
  hubTask("ord-6", "Old fix", { area: "Orders", status: "done" }),
];

const THREADS = [
  chat("t1", "ord-9", BOB, "working"),
  chat("t2", "ord-9", BOB, "working"),
  chat("t3", "ord-11", ANA, "idle"),
  chat("t4", "ord-15", BOB, "working"),
  chat("t5", "ord-7", SLAVO, "idle"),
  chat("t6", "ord-7", ANA, "working"),
  chat("t7", "ord-12", CYRIL, "blocked"),
  chat("t8", "ord-14", EVA, "working"),
  chat("t9", undefined, ANA, "working"),
];

const SESSIONS = [
  session("claude:b1", BOB, "ord-9", { files: ["src/payments/fees.ts"], activeAt: minutes(5) }),
  session("claude:b2", BOB, "ord-15", {
    files: ["src/payments/refunds.ts"],
    activeAt: minutes(6),
  }),
  session("claude:c1", CYRIL, "ord-12", {
    status: "blocked",
    files: ["src/orders/notes.ts"],
    activeAt: minutes(18),
  }),
  session("claude:s1", SLAVO, "ord-7", { files: ["src/orders/notes.ts"], activeAt: minutes(3) }),
];

function ownershipView(overrides: Partial<PeerOwnershipProject> = {}): PeerOwnershipProject {
  return {
    workspace: "acme",
    project: "ordering",
    at: minutes(0),
    leads: [SLAVO],
    map: {
      version: 7,
      areas: { Orders: SLAVO, Payments: ANA, Menu: CYRIL },
      paths: { "src/payments/**": ANA, "src/orders/**": SLAVO, "src/menu/**": CYRIL },
      decide: ["src/payments/**"],
    },
    tasks: {
      "ord-9": owner("ord-9", BOB, "request"),
      "ord-11": owner("ord-11", ANA),
      "ord-15": owner("ord-15", BOB),
      "ord-7": owner("ord-7", SLAVO),
      "ord-12": owner("ord-12", CYRIL),
    },
    calls: [call()],
    ...overrides,
  };
}

function statusOf(setup: Setup = {}): PeerHubStatus {
  const viewer = setup.viewer ?? SLAVO;
  const coordination = setup.coordination ?? true;
  return {
    hubUrl: "https://hub.example.test",
    signedIn: true,
    email: viewer,
    pendingSignIn: null,
    workspaces: [
      {
        slug: "acme",
        name: "Acme",
        role: setup.workspaceRole ?? "member",
        allowedDomains: [],
        currency: "EUR",
        memberName: "Slavo",
        companyKnowledge: null,
        projects: [
          {
            project: {
              id: "ordering",
              name: "Ordering demo",
              role: setup.role ?? (viewer === SLAVO ? "lead" : "member"),
              members: MEMBERS,
              repositories: [],
              knowledge: { kontext: false, company: false },
              tools: [],
              capacity: { personal: "any", personalHarnesses: [] },
            },
            repositories: [],
            tools: [],
            sharedCapacity: { enabled: false, instanceIds: [] },
            work: {
              areas: ["Orders", "Payments", "Menu"],
              tasks: [...(setup.tasks ?? TASKS)],
              threads: [...(setup.threads ?? THREADS)],
            },
            peers: [],
          },
        ],
        lastSyncAt: null,
        error: null,
      },
    ],
    // What the two people asked of each other is theirs: no view of the team may read it.
    requests: [
      {
        workspace: "acme",
        request: {
          id: "r1",
          project: "ordering",
          task: "ord-9",
          sender: ANA,
          recipient: BOB,
          title: "SECRET request title",
          prompt: "SECRET request prompt",
          status: "pending",
          createdAt: minutes(300),
          updatedAt: minutes(300),
        },
      },
    ],
    joinable: [],
    workspaceRoot: "/w",
    environmentId: EnvironmentId.make("env-here"),
    agents: { herdr: "not-running", list: [] },
    github: { cli: false, account: null, signIn: null, error: null },
    coordination: {
      enabled: coordination,
      policy: "coordinate",
      claudeHooks: false,
      logPath: "",
      sessions: coordination ? [...(setup.sessions ?? SESSIONS)] : [],
      overlaps: coordination ? [...(setup.overlaps ?? [overlap()])] : [],
      findings: [],
      contexts: [],
      candidates: [],
    },
    sharedThreads: [],
    syncing: false,
    lastSyncAt: null,
    error: null,
    ...(setup.ownership === null
      ? {}
      : { ownership: { projects: [ownershipView(setup.ownership)] } }),
  };
}

/** The Team view as `setup` sees it. */
function teamOf(setup: Setup = {}, now = NOW): TeamView {
  const status = statusOf(setup);
  const [project] = buildWorkTree({ status, localThreads: [], now });
  return buildTeamView({ status, project: project!, now });
}

const taskOf = (view: TeamView, key: string): TeamTask => {
  const found = view.areas.flatMap((area) => area.tasks).find((task) => task.key === key);
  if (found === undefined) throw new Error(`no task ${key} in the Team view`);
  return found;
};

describe("the people strip", () => {
  const view = teamOf();
  const person = (name: string) => view.people.find((candidate) => candidate.name === name)!;

  it("lists the project's members, the person looking first", () => {
    expect(view.people.map((candidate) => candidate.name)).toEqual([
      "Slavo",
      "Ana",
      "Bob",
      "Cyril",
      "Eva",
    ]);
    expect(person("Slavo")).toMatchObject({ mine: true, lead: true });
    expect(person("Ana")).toMatchObject({ mine: false, lead: false });
  });

  it("counts each person's agents at work and those that wait for them, from the whole project", () => {
    expect(person("Bob")).toMatchObject({ working: 3, waiting: 0 });
    // Ana has a chat on no task as well as one on ORD-7.
    expect(person("Ana")).toMatchObject({ working: 2, waiting: 0 });
    expect(person("Cyril")).toMatchObject({ working: 0, waiting: 1 });
    expect(person("Eva")).toMatchObject({ working: 1, waiting: 0 });
    expect(person("Slavo")).toMatchObject({ working: 0, waiting: 0 });
  });

  it("counts the open and in-review tasks each owns, and the areas", () => {
    expect(person("Bob")).toMatchObject({ owns: 2, areas: [] });
    expect(person("Ana")).toMatchObject({ owns: 1, areas: ["Payments"] });
    expect(person("Slavo")).toMatchObject({ owns: 1, areas: ["Orders"] });
    expect(person("Cyril")).toMatchObject({ owns: 1, areas: ["Menu"] });
    expect(person("Eva")).toMatchObject({ owns: 0, areas: [] });
  });

  it("counts the decisions that wait on each person: calls to them and reviews that ask them", () => {
    // ORD-11 is Ana's to review, and Bob's call waits for her; ORD-7 is Slavo's.
    expect(person("Ana").decisions).toBe(2);
    expect(person("Slavo").decisions).toBe(1);
    for (const name of ["Bob", "Cyril", "Eva"]) expect(person(name).decisions, name).toBe(0);
    expect(view.waitingOnMe).toBe(1);
  });

  it("says each in the design's words", () => {
    const words = (name: string) => teamPersonWords(person(name));
    expect(words("Bob")).toEqual({
      agents: "3 agents at work",
      owns: "Owns 2 tasks",
      waiting: "Nothing waits",
    });
    expect(words("Ana")).toEqual({
      agents: "2 agents at work",
      owns: "Owns 1 task · area Payments",
      waiting: "2 wait on Ana",
    });
    expect(words("Cyril")).toEqual({
      agents: "1 agent waits for Cyril",
      owns: "Owns 1 task · area Menu",
      waiting: "Nothing waits",
    });
    expect(words("Eva")).toEqual({
      agents: "1 agent at work",
      owns: "Owns no tasks",
      waiting: "Nothing waits",
    });
    expect(words("Slavo")).toEqual({
      agents: "No agents at work",
      owns: "Owns 1 task · area Orders",
      waiting: "1 waits on you",
    });
  });

  it("counts a project's decisions for the tile without building the page", () => {
    const status = statusOf();
    const [project] = buildWorkTree({ status, localThreads: [], now: NOW });
    expect(decisionsWaitingOn(project!, NOW)).toBe(1);
    expect(decisionsWaitingOn(project!, NOW, ANA)).toBe(2);
    expect(decisionsWaitingOn(project!, NOW, null)).toBe(0);
    const [none] = buildWorkTree({
      status: statusOf({ ownership: null }),
      localThreads: [],
      now: NOW,
    });
    expect(decisionsWaitingOn(none!, NOW)).toBe(0);
  });
});

describe("what needs a person", () => {
  const view = teamOf();
  const signals = view.signals.map(({ kind, what, detail, action, open }) => ({
    kind,
    what,
    detail,
    action,
    open,
  }));

  it("lists each condition once, in the order of the design, in its words", () => {
    expect(signals).toEqual([
      {
        kind: "call-waiting",
        what: "Bob's agent waits for Ana's call",
        detail: "ORD-9 · src/payments/fees.ts · “add a refund fee field”",
        action: "Open task",
        open: { kind: "task", task: "ord-9" },
      },
      {
        kind: "review-waiting",
        what: "ORD-11 waits for its review by Ana",
        detail: "Receipt totals in cents · in review since yesterday",
        action: "Open review",
        open: { kind: "review", task: "ord-11" },
      },
      {
        kind: "agent-waiting",
        what: "Cyril's agent waits for Cyril",
        detail: "ORD-12 · Menu photos",
        action: "Open task",
        open: { kind: "task", task: "ord-12" },
      },
      {
        kind: "overlap-open",
        what: "Overlap open on src/orders/notes.ts",
        detail: "ORD-7 (Slavo) and ORD-12 (Cyril)",
        action: "Open overlap",
        open: { kind: "overlap", overlap: "o1" },
      },
      {
        kind: "landing-stopped",
        what: "A push from ORD-15 waits for Ana's call",
        detail: "Bob's agent changed src/payments/refunds.ts and has not asked yet",
        action: "Open task",
        open: { kind: "task", task: "ord-15" },
      },
      {
        kind: "no-owner",
        what: "ORD-14 has an agent at work and no owner",
        detail: "Checkout copy · Eva · 1 working",
        action: "Set owner",
        open: { kind: "set-owner", task: "ord-14" },
      },
    ]);
  });

  it("says since when, and for how long", () => {
    const ages = Object.fromEntries(
      view.signals.map((signal) => [
        signal.kind,
        signal.ageMs === undefined ? null : Math.round(signal.ageMs / 60_000),
      ]),
    );
    expect(ages).toEqual({
      "call-waiting": 40,
      "review-waiting": 26 * 60,
      "agent-waiting": 18,
      "overlap-open": 35,
      "landing-stopped": 6,
      "no-owner": null,
    });
    expect(view.signals.find((signal) => signal.kind === "call-waiting")?.since).toBe(minutes(40));
  });

  it("lists nothing where nothing waits", () => {
    const calm = teamOf({
      ownership: { calls: [], tasks: {} },
      sessions: [],
      overlaps: [],
      tasks: TASKS.filter((task) => task.status === "open" && task.id !== "ord-14"),
      threads: THREADS.filter((thread) => thread.id !== "t8"),
    });
    expect(calm.signals).toEqual([]);
  });

  it("opens the call for the owner who decides it, and the task for everyone else", () => {
    // The page says the same to everyone; what it opens depends on who is looking.
    const ana = teamOf({ viewer: ANA }).signals[0];
    expect(ana).toMatchObject({
      kind: "call-waiting",
      what: "Bob's agent waits for Ana's call",
      action: "Decide",
      open: { kind: "owner-call", call: "oc-1" },
    });
    const bob = teamOf({ viewer: BOB }).signals[0];
    expect(bob).toMatchObject({
      what: "Bob's agent waits for Ana's call",
      action: "Open task",
      open: { kind: "task", task: "ord-9" },
    });
  });

  it("asks a member who cannot name owners to open the task, not to set its owner", () => {
    const signal = teamOf({ viewer: BOB }).signals.find(
      (candidate) => candidate.kind === "no-owner",
    );
    expect(signal).toMatchObject({ action: "Open task", open: { kind: "task", task: "ord-14" } });
  });

  it("counts a wait from when it began, and only once it is over its limit", () => {
    const only = (kind: string, view: TeamView) =>
      view.signals.filter((signal) => signal.kind === kind).length;
    const limits = TEAM_SIGNAL_AFTER_MS;
    expect(limits).toEqual({
      call: 30 * 60_000,
      review: 24 * 60 * 60_000,
      agent: 15 * 60_000,
      overlap: 30 * 60_000,
    });
    const calls = (ago: number) =>
      teamOf({ ownership: { calls: [call({ createdAt: minutes(ago) })] } });
    expect([29, 30, 31].map((ago) => only("call-waiting", calls(ago)))).toEqual([0, 0, 1]);
    // A review: the Hub's last word on the task is when it went to review.
    const reviews = (ago: number) =>
      teamOf({
        tasks: TASKS.map((task) =>
          task.id === "ord-11" ? { ...task, updatedAt: minutes(ago) } : task,
        ),
      });
    expect(
      [24 * 60 - 1, 24 * 60, 24 * 60 + 1].map((ago) => only("review-waiting", reviews(ago))),
    ).toEqual([0, 0, 1]);
    // An agent waiting for its person.
    const agents = (ago: number) =>
      teamOf({
        sessions: SESSIONS.map((s) =>
          s.id === "claude:c1" ? { ...s, activeAt: minutes(ago) } : s,
        ),
      });
    expect([14, 15, 16].map((ago) => only("agent-waiting", agents(ago)))).toEqual([0, 0, 1]);
    // An overlap nobody has touched: a note counts as touching it.
    const overlaps = (ago: number, noteAgo?: number) =>
      teamOf({
        overlaps: [
          overlap({
            updatedAt: minutes(ago),
            ...(noteAgo === undefined
              ? {}
              : { notes: [{ id: "n", email: ANA, text: "hello", at: minutes(noteAgo) }] }),
          }),
        ],
      });
    expect([29, 30, 31].map((ago) => only("overlap-open", overlaps(ago)))).toEqual([0, 0, 1]);
    expect(only("overlap-open", overlaps(90, 10))).toBe(0);
  });

  it("leaves out a call that is decided or lapsed, a closed overlap, and a task with nobody at work", () => {
    expect(
      teamOf({ ownership: { calls: [call({ state: "declined" })] } }).signals.map((s) => s.kind),
    ).not.toContain("call-waiting");
    expect(
      teamOf({ ownership: { calls: [call({ expiresAt: minutes(1) })] } }).signals.map(
        (s) => s.kind,
      ),
    ).not.toContain("call-waiting");
    expect(
      teamOf({ overlaps: [overlap({ state: "resolved" })] }).signals.map((s) => s.kind),
    ).not.toContain("overlap-open");
    const idle = THREADS.map((thread) =>
      thread.id === "t8" ? { ...thread, status: "idle" as const } : thread,
    );
    expect(teamOf({ threads: idle }).signals.map((s) => s.kind)).not.toContain("no-owner");
  });
});

describe("areas and tasks", () => {
  const view = teamOf();

  it("groups the open and in-review tasks by area, in the project's order, with each area's owner", () => {
    expect(
      view.areas.map((area) => [area.name, area.owner?.name, area.tasks.map((t) => t.key)]),
    ).toEqual([
      ["Orders", "Slavo", ["ORD-7"]],
      ["Payments", "Ana", ["ORD-9", "ORD-11", "ORD-15"]],
      ["Menu", "Cyril", ["ORD-12"]],
      [null, undefined, ["ORD-14"]],
    ]);
    // A done task is no part of it.
    expect(view.areas.flatMap((area) => area.tasks).map((task) => task.key)).not.toContain("ORD-6");
  });

  it("leaves out a task that is finished, in the Hub's words or in the board's", () => {
    // Every chat of ORD-9 delivered its pull request: the board counts the task as done.
    const merged = THREADS.map((thread) =>
      thread.task === "ord-9"
        ? { ...thread, status: "done" as const, delivery: "merged" as const }
        : thread,
    );
    const keys = (view: TeamView) =>
      view.areas.flatMap((area) => area.tasks.map((task) => task.key));
    expect(keys(teamOf({ threads: merged }))).not.toContain("ORD-9");
    expect(keys(teamOf())).toContain("ORD-9");
    // A review of a finished task asks nobody.
    const finished = THREADS.map((thread) =>
      thread.task === "ord-11"
        ? { ...thread, status: "done" as const, delivery: "merged" as const }
        : thread,
    );
    const view = teamOf({ threads: finished });
    expect(keys(view)).not.toContain("ORD-11");
    expect(view.people.find((person) => person.name === "Ana")?.decisions).toBe(1);
  });

  it("says what each area's owner decides", () => {
    expect(view.areas.map((area) => area.rule)).toEqual([
      "Slavo owns src/orders/**; changes by others are shown, not stopped",
      "Ana decides changes by others in src/payments/**",
      "Cyril owns src/menu/**; changes by others are shown, not stopped",
      "Tasks without an area fall back to their own owner",
    ]);
  });

  it("shows each task's owner and its state in the words the board uses", () => {
    const states = Object.fromEntries(
      view.areas.flatMap((area) =>
        area.tasks.map((task) => [task.key, [task.owner?.name ?? null, task.state.label]]),
      ),
    );
    expect(states).toEqual({
      "ORD-7": ["Slavo", "Waiting for your review"],
      "ORD-9": ["Bob", "In progress"],
      "ORD-11": ["Ana", "Waiting for Ana's review"],
      "ORD-15": ["Bob", "In progress"],
      "ORD-12": ["Cyril", "Waiting on Cyril"],
      "ORD-14": [null, "In progress"],
    });
  });

  it("counts each task's agents by person and status, never naming a chat", () => {
    const line = (key: string) => agentsLine(taskOf(view, key).agents);
    expect(line("ORD-9")).toBe("Bob · 2 working");
    expect(line("ORD-11")).toBe("Ana · 1 idle");
    expect(line("ORD-7")).toBe("Slavo · 1 idle · Ana · 1 working");
    expect(line("ORD-12")).toBe("Cyril · 1 waiting");
    expect(agentsLine(taskOf(view, "ORD-7").agents, { mineAs: "Your agent" })).toBe(
      "Your agent · 1 idle · Ana · 1 working",
    );
    expect(agentsLine([])).toBe("No agents yet");
  });

  it("gives each task the facts that explain it", () => {
    const badges = (key: string) =>
      taskOf(view, key).badges.map(({ text, tone }) => `${tone}: ${text}`);
    expect(badges("ORD-9")).toEqual([
      "needs: Waiting on Ana's call",
      "plain: Changed Ana's path src/payments/fees.ts",
    ]);
    expect(badges("ORD-11")).toEqual(["needs: Review by Ana · 1 day"]);
    expect(badges("ORD-15")).toEqual(["needs: Push stopped: needs Ana's call"]);
    expect(badges("ORD-7")).toEqual(["needs: Review by you", "plain: Overlap with ORD-12"]);
    expect(badges("ORD-12")).toEqual([
      "plain: Changed Slavo's path src/orders/notes.ts",
      "plain: Overlap with ORD-7",
    ]);
    expect(badges("ORD-14")).toEqual([]);
  });

  it("carries a task's pending calls, the changes in other people's paths and its review", () => {
    const nine = taskOf(view, "ORD-9");
    expect(nine.calls).toEqual([
      {
        id: "oc-1",
        asker: "Bob",
        askerMine: false,
        owner: "Ana",
        ownerMine: false,
        paths: ["src/payments/fees.ts"],
        reason: "add a refund fee field",
        since: minutes(40),
        expiresAt: inDays(6),
      },
    ]);
    expect(nine.changes).toEqual([
      {
        person: "Bob",
        path: "src/payments/fees.ts",
        owner: "Ana",
        ownerMine: false,
        decides: true,
        waitsForCall: true,
        asked: true,
      },
    ]);
    expect(taskOf(view, "ORD-11").review).toMatchObject({
      route: { audience: "owner", forMe: false, names: ["Ana"] },
      since: hours(26),
    });
    expect(nine.review).toBeUndefined();
    expect(taskOf(view, "ORD-12").overlaps).toEqual([
      { id: "o1", with: [{ id: "ord-7", key: "ORD-7" }] },
    ]);
  });

  it("says in a badge how long a review has waited once it is a day or more", () => {
    const longer = teamOf({
      tasks: TASKS.map((task) => (task.id === "ord-11" ? { ...task, updatedAt: hours(80) } : task)),
    });
    expect(taskOf(longer, "ORD-11").badges.map((badge) => badge.text)).toEqual([
      "Review by Ana · 3 days",
    ]);
    expect(taskOf(teamOf({ viewer: ANA }), "ORD-11").badges[0]?.text).toBe("Review by you · 1 day");
  });
});

describe("counting agents", () => {
  const node = (
    person: string,
    status: "working" | "blocked" | "idle" | "done" | "unknown",
    extra: Record<string, unknown> = {},
  ) =>
    ({
      key: `${person}-${status}`,
      title: "SECRET",
      person,
      mine: false,
      status,
      stale: false,
      delivery: "open",
      ...extra,
    }) as unknown as Parameters<typeof countAgents>[0][number];

  it("counts by person and status, the person looking first, then by name, without a title", () => {
    const counted = countAgents([
      node("Cyril", "blocked", { email: CYRIL }),
      node("Bob", "working", { email: BOB }),
      node("Bob", "idle", { email: BOB }),
      node("Bob", "done", { email: BOB }),
      node("Slavo", "working", { email: SLAVO, mine: true }),
      node("Ana", "unknown", { email: ANA, stale: true }),
    ]);
    expect(
      counted.map(({ name, working, waiting, idle, away }) => [name, working, waiting, idle, away]),
    ).toEqual([
      ["Slavo", 1, 0, 0, 0],
      ["Ana", 0, 0, 0, 1],
      ["Bob", 1, 0, 2, 0],
      ["Cyril", 0, 1, 0, 0],
    ]);
    expect(JSON.stringify(counted)).not.toContain("SECRET");
  });

  it("tells two people of one name apart by address, and counts a chat with none by its name", () => {
    const counted = countAgents([
      node("Ana", "working", { email: ANA }),
      node("Ana", "working", { email: "ana.k@acme.test" }),
      node("Dan", "idle"),
      node("Dan", "idle"),
    ]);
    expect(counted.map(({ name, email, working, idle }) => [name, email, working, idle])).toEqual([
      ["Ana", ANA, 1, 0],
      ["Ana", "ana.k@acme.test", 1, 0],
      ["Dan", undefined, 0, 2],
    ]);
  });

  it("leaves out work that was delivered", () => {
    expect(
      countAgents([
        node("Bob", "working", { delivery: "merged" }),
        node("Bob", "idle", { delivery: "closed" }),
      ]),
    ).toEqual([]);
  });
});

describe("what the Team view never shows", () => {
  it("carries no chat title, session label, request or prompt of anyone", () => {
    const viewed = [teamOf(), teamOf({ viewer: ANA }), teamOf({ viewer: BOB })];
    for (const view of viewed) {
      expect(JSON.stringify(view)).not.toContain("SECRET");
    }
  });

  it("counts a colleague's chat that nobody reports any more as away, not at work", () => {
    const stale = THREADS.map((thread) =>
      thread.id === "t1" ? { ...thread, seenAt: hours(2) } : thread,
    );
    const view = teamOf({ threads: stale });
    expect(agentsLine(taskOf(view, "ORD-9").agents)).toBe("Bob · 1 working, 1 away");
    expect(view.people.find((candidate) => candidate.name === "Bob")?.working).toBe(2);
  });

  it("leaves out a chat whose work was delivered", () => {
    const delivered = THREADS.map((thread) =>
      thread.id === "t1" ? { ...thread, delivery: "merged" as const } : thread,
    );
    expect(agentsLine(taskOf(teamOf({ threads: delivered }), "ORD-9").agents)).toBe(
      "Bob · 1 working",
    );
  });
});

describe("the Team view's honest gaps", () => {
  it("shows what it can, and says so, where this computer's coordination is off", () => {
    const view = teamOf({ coordination: false });
    expect(view.coordinationOff).toBe(true);
    expect(view.known).toBe(true);
    expect(view.signals.map((signal) => signal.kind)).toEqual([
      "call-waiting",
      "review-waiting",
      "no-owner",
    ]);
    // Without sessions nothing says which paths agents changed.
    expect(taskOf(view, "ORD-9").changes).toEqual([]);
    expect(taskOf(view, "ORD-9").badges.map((badge) => badge.text)).toEqual([
      "Waiting on Ana's call",
    ]);
    expect(view.people.length).toBe(5);
    expect(view.areas.length).toBe(4);
    expect(teamOf().coordinationOff).toBe(false);
  });

  it("has nothing of the Team view where ownership is not known, as the plugin off or an older Hub", () => {
    const view = teamOf({ ownership: null });
    expect(view).toMatchObject({
      known: false,
      people: [],
      signals: [],
      areas: [],
      waitingOnMe: 0,
      canManage: false,
    });
  });

  it("lets leads and admins manage, and says how old the Hub's view is", () => {
    expect(teamOf().canManage).toBe(true);
    expect(teamOf({ viewer: BOB }).canManage).toBe(false);
    expect(teamOf({ viewer: BOB, workspaceRole: "admin" }).canManage).toBe(true);
    expect(teamOf().at).toBe(minutes(0));
  });

  it("shows an area whose owner left, or that the owner map does not name, without an owner", () => {
    const left = teamOf({
      ownership: {
        map: { version: 8, areas: { Orders: "dan@acme.test" }, paths: {}, decide: [] },
        tasks: {},
        calls: [],
      },
    });
    expect(left.areas.find((area) => area.name === "Orders")?.owner).toBeUndefined();
    expect(left.areas.find((area) => area.name === "Payments")?.owner).toBeUndefined();
    expect(left.areas.find((area) => area.name === "Orders")?.rule).toBeUndefined();
  });
});

describe("limited members", () => {
  it("keeps the projects of each member an invitation limited, by address in lower case", () => {
    const limits = memberLimits([
      { email: "Cyril@Acme.test", projects: ["webshop"] },
      { email: "ana@acme.test", projects: null },
      { email: "bob@acme.test" },
    ]);
    expect([...limits]).toEqual([["cyril@acme.test", ["webshop"]]]);
  });

  it("says which projects, and only those", () => {
    expect(onlyOnWords(["Webshop"])).toBe("On Webshop only");
    expect(onlyOnWords(["Webshop", "Billing", "Docs"])).toBe("On Webshop, Billing and Docs only");
  });
});
