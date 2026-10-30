import {
  EnvironmentId,
  ThreadId,
  type PeerHubStatus,
  type PeerOwnerCall,
  type PeerOwnershipProject,
  type PeerTask,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import type { NeedsYouItem } from "./needsYou.ts";
import { projectOwnership } from "./ownership.ts";
import {
  ALL_PROJECTS,
  buildWorkTree,
  taskCards,
  taskCounts,
  taskOwnership,
  taskState,
  taskWhy,
  type TaskCard,
  type TaskHandoff,
  type WorkProjectNode,
  type WorkTaskCard,
  type WorkTaskNode,
  type WorkThreadNode,
} from "./work.ts";

const ANA = "ana@acme.test";
const BOB = "bob@acme.test";
const CYRIL = "cyril@acme.test";
const EVA = "eva@acme.test";
const DAN = "dan@acme.test";
const HERE = EnvironmentId.make("env-here");
const NOW = Date.parse("2026-10-12T21:00:00Z");
const iso = (at: number) => DateTime.formatIso(DateTime.makeUnsafe(at));
const minutes = (count: number) => iso(NOW - count * 60_000);

const MEMBERS = [
  { email: ANA, name: "Ana" },
  { email: BOB, name: "Bob" },
  { email: CYRIL, name: "Cyril" },
  { email: EVA, name: "Eva" },
];

function view(overrides: Partial<PeerOwnershipProject> = {}): PeerOwnershipProject {
  return {
    workspace: "acme",
    project: "ordering",
    at: minutes(0),
    leads: [EVA],
    map: { version: 3, areas: { Payments: ANA }, paths: {}, decide: [] },
    tasks: {
      vl7: { project: "ordering", task: "vl7", owner: ANA, since: minutes(60), reason: "named" },
      vl9: { project: "ordering", task: "vl9", owner: BOB, since: minutes(30), reason: "request" },
    },
    calls: [],
    ...overrides,
  };
}

/** Ordering's ownership as `email` looks at it, or none where the plugin is off. */
function ownershipFor(
  email: string,
  overrides: Partial<PeerOwnershipProject> | null = {},
  members = MEMBERS,
) {
  return overrides === null
    ? undefined
    : projectOwnership(
        { email, ownership: { projects: [view(overrides)] } },
        { slug: "acme", role: "member" },
        { id: "ordering", role: email === EVA ? "lead" : "member", members },
      );
}

function thread(key: string, overrides: Partial<WorkThreadNode> = {}): WorkThreadNode {
  return {
    key,
    title: key,
    person: "You",
    mine: true,
    status: "idle",
    delivery: "open",
    harness: undefined,
    branch: undefined,
    source: "peer",
    stale: false,
    open: undefined,
    placeable: true,
    concerns: undefined,
    observable: false,
    agent: undefined,
    activeAt: undefined,
    keepsContext: false,
    ...overrides,
  };
}

/** A chat of the person's that Peer can open. */
const chat = (key: string, overrides: Partial<WorkThreadNode> = {}) =>
  thread(key, {
    open: { kind: "thread", environmentId: HERE, threadId: ThreadId.make(key) },
    ...overrides,
  });

function task(
  id: string,
  threads: ReadonlyArray<WorkThreadNode> = [],
  overrides: Partial<WorkTaskNode> = {},
): WorkTaskNode {
  return {
    id,
    key: id.toUpperCase(),
    title: `Task ${id}`,
    done: false,
    status: "idle",
    threads,
    removable: true,
    context: undefined,
    ...overrides,
  };
}

function hubTask(id: string, overrides: Partial<PeerTask> = {}): PeerTask {
  return {
    id,
    title: `Task ${id}`,
    status: "open",
    createdBy: "someone@acme.test",
    createdAt: "2026-10-01T09:00:00Z",
    updatedAt: "2026-10-01T09:00:00Z",
    ...overrides,
  };
}

/** Project `ordering` with `tasks` in its area Payments, as `email` sees it. */
function ordering(
  tasks: ReadonlyArray<WorkTaskNode>,
  ownership: ReturnType<typeof ownershipFor>,
  more: Partial<WorkProjectNode> = {},
): WorkProjectNode {
  return {
    workspace: "acme",
    workspaceName: "Acme",
    projectId: "ordering",
    name: "Ordering demo",
    areas: [{ name: "Payments", tasks }],
    unsorted: [],
    context: undefined,
    candidates: 0,
    tasks: tasks.map((entry) => hubTask(entry.id, { area: "Payments" })),
    ownership,
    ...more,
  };
}

const everyone = { scope: ALL_PROJECTS, mine: false, query: "" };
const cardKey = (card: TaskCard) => (card.kind === "task" ? (card.task.key ?? "") : card.item.key);
const inColumn = (cards: ReadonlyArray<TaskCard>, column: TaskCard["column"]) =>
  cards.filter((card) => card.column === column).map(cardKey);

function onlyTask(cards: ReadonlyArray<TaskCard>, key: string): WorkTaskCard {
  const card = cards.find((candidate) => cardKey(candidate) === key);
  if (card?.kind !== "task") throw new Error(`no task card ${key}`);
  return card;
}

/** A task in review, owned by Bob, as each of the project's people sees the board. */
const reviewBoard = (email: string, overrides: Partial<PeerOwnershipProject> | null = {}) =>
  taskCards([ordering([task("vl9", [], { inReview: true })], ownershipFor(email, overrides))], {
    ...everyone,
    me: email,
  });

/** No area, path or owner is named: nobody owns anything, and the project has its lead. */
const NO_OWNERS = { tasks: {}, map: { version: 1, areas: {}, paths: {}, decide: [] } };

describe("a task in review asks its owner", () => {
  it("is in the owner's Needs you and not in anybody else's, who still see it in review", () => {
    const bob = onlyTask(reviewBoard(BOB), "VL9");
    expect(bob.column).toBe("needs");
    expect(bob.state.label).toBe("Waiting for your review");
    expect(bob.action).toMatchObject({ label: "Review", target: { kind: "review", task: "vl9" } });

    // Bob owns VL9 by its own row, which comes before Payments, whose owner is Ana.
    for (const email of [ANA, CYRIL, EVA]) {
      const other = onlyTask(reviewBoard(email), "VL9");
      expect(other.column, email).toBe("working");
      expect(other.state, email).toEqual({
        kind: "waiting",
        label: "Waiting for Bob's review",
        waitingOn: "Bob",
      });
      expect(other.action, email).toBeUndefined();
      expect(other.review, email).toEqual({ audience: "owner", forMe: false, names: ["Bob"] });
      expect(inColumn(reviewBoard(email), "needs"), email).toEqual([]);
    }
  });

  it("goes to the owner of its area where the task has no owner of its own", () => {
    const ownedByArea = { tasks: {} };
    const ana = onlyTask(reviewBoard(ANA, ownedByArea), "VL9");
    expect(ana).toMatchObject({
      column: "needs",
      owner: { name: "Ana", throughArea: "Payments" },
      state: { label: "Waiting for your review" },
    });
    // Not the lead's, either: the project's leads are asked only where nobody owns the task.
    expect(onlyTask(reviewBoard(EVA, ownedByArea), "VL9")).toMatchObject({
      column: "working",
      state: { label: "Waiting for Ana's review" },
    });
  });

  it("asks the project's leads where nobody owns the task", () => {
    expect(onlyTask(reviewBoard(EVA, NO_OWNERS), "VL9")).toMatchObject({
      column: "needs",
      state: { label: "Waiting for your review" },
      review: { audience: "leads", forMe: true, names: ["Eva"] },
    });
    for (const email of [ANA, BOB, CYRIL]) {
      const card = onlyTask(reviewBoard(email, NO_OWNERS), "VL9");
      expect(card.column, email).toBe("working");
      expect(card.state.label, email).toBe("Waiting for Eva's review");
      expect(card.owner, email).toBeUndefined();
    }
  });

  it("names several leads as a lead, and asks each of them", () => {
    const leads = { ...NO_OWNERS, leads: [EVA, CYRIL] };
    expect(onlyTask(reviewBoard(ANA, leads), "VL9").state.label).toBe(
      "Waiting for a lead's review",
    );
    expect(inColumn(reviewBoard(CYRIL, leads), "needs")).toEqual(["VL9"]);
    expect(inColumn(reviewBoard(EVA, leads), "needs")).toEqual(["VL9"]);
  });

  it("asks every member where the project has no leads, as before ownership", () => {
    for (const email of [ANA, BOB, EVA]) {
      const card = onlyTask(reviewBoard(email, { ...NO_OWNERS, leads: [] }), "VL9");
      expect(card.column, email).toBe("needs");
      expect(card.state.label, email).toBe("Waiting for review");
      expect(card.review?.audience, email).toBe("everyone");
    }
  });

  it("falls back to the area, and then the leads, when the task's owner left", () => {
    const left = { tasks: { vl9: { ...view().tasks.vl9!, owner: DAN } } };
    expect(onlyTask(reviewBoard(ANA, left), "VL9")).toMatchObject({
      column: "needs",
      owner: { name: "Ana", throughArea: "Payments" },
    });
    expect(onlyTask(reviewBoard(BOB, left), "VL9").column).toBe("working");
    const alone = { ...left, map: NO_OWNERS.map };
    expect(onlyTask(reviewBoard(EVA, alone), "VL9").column).toBe("needs");
    expect(onlyTask(reviewBoard(ANA, alone), "VL9").column).toBe("working");
  });

  it("behaves as before where ownership is off, an older Hub, or no view was read", () => {
    for (const email of [ANA, BOB, EVA]) {
      const card = onlyTask(reviewBoard(email, null), "VL9");
      expect(card.column, email).toBe("needs");
      expect(card.state.label, email).toBe("Waiting for review");
      expect(card.owner, email).toBeUndefined();
      expect(card.review, email).toEqual({ audience: "everyone", forMe: true, names: [] });
      expect(card.action?.label, email).toBe("Review");
    }
  });

  it("puts what the person's own chat waits for before another person's review", () => {
    const waiting = chat("mine", { status: "blocked" });
    const board = (email: string) =>
      taskCards([ordering([task("vl9", [waiting], { inReview: true })], ownershipFor(email))], {
        ...everyone,
        me: email,
      });
    // Ana is not asked for the review, but her own chat asks her a question.
    const ana = onlyTask(board(ANA), "VL9");
    expect(ana.state.kind).toBe("input");
    expect(ana.column).toBe("needs");
    expect(ana.action).toMatchObject({ label: "Answer" });
    // Bob is asked for the review, which comes first.
    expect(onlyTask(board(BOB), "VL9").state.label).toBe("Waiting for your review");
  });

  it("counts a review under Needs you for the person it asks only", () => {
    const projectFor = (email: string) =>
      ordering([task("vl9", [], { inReview: true }), task("vl12")], ownershipFor(email));
    expect(taskCounts(projectFor(BOB)).needs).toBe(1);
    expect(taskCounts(projectFor(ANA)).needs).toBe(0);
    expect(taskCounts(projectFor(ANA))).toMatchObject({ working: 1, new: 1 });
  });

  it("says in a card's line whose review it waits for, with the handoff", () => {
    const handoff: TaskHandoff = {
      number: 3,
      author: "Bob",
      mine: false,
      byAgent: false,
      at: minutes(10),
    };
    const why = (card: WorkTaskCard, handed: TaskHandoff | undefined) =>
      taskWhy(card, { handoff: handed, agentName: () => undefined });
    const ana = onlyTask(reviewBoard(ANA), "VL9");
    expect(why(ana, handoff)).toEqual({ text: "Handoff #3 from Bob", at: handoff.at });
    expect(why(ana, undefined).text).toBe("A handoff waits for review");
    expect(why(onlyTask(reviewBoard(BOB), "VL9"), undefined).text).toBe(
      "A handoff waits for your review",
    );
  });
});

describe("a view that words a task's state itself", () => {
  it("gets the card's words by passing the route of the task's review", () => {
    for (const email of [ANA, BOB, EVA]) {
      const project = ordering([task("vl9", [], { inReview: true })], ownershipFor(email));
      const [node] = project.areas[0]!.tasks;
      const { owner, review } = taskOwnership(project, node!, "Payments");
      const card = onlyTask(taskCards([project], { ...everyone, me: email }), "VL9");
      expect(taskState(node!, new Map(), review), email).toEqual(card.state);
      expect(owner, email).toEqual(card.owner);
      // Without the route it reads as before ownership: every review asks the person.
      expect(taskState(node!).label, email).toBe("Waiting for review");
    }
  });

  it("has no route for a task that is not in review, and none of its own where ownership is off", () => {
    const project = ordering(
      [task("vl9"), task("vl10", [], { inReview: true })],
      ownershipFor(ANA),
    );
    const [open, review] = project.areas[0]!.tasks;
    expect(taskOwnership(project, open!, "Payments")).toMatchObject({ review: undefined });
    expect(taskOwnership(project, review!, "Payments").review?.audience).toBe("owner");
    const off = ordering([task("vl10", [], { inReview: true })], undefined);
    expect(taskOwnership(off, off.areas[0]!.tasks[0]!, null)).toEqual({
      owner: undefined,
      review: { audience: "everyone", forMe: true, names: [] },
    });
  });
});

describe("Mine includes the tasks you own", () => {
  const mine = (email: string, tasks: ReadonlyArray<WorkTaskNode>) =>
    taskCards([ordering(tasks, ownershipFor(email))], { ...everyone, mine: true, me: email }).map(
      cardKey,
    );

  it("has a task you own without a chat of yours", () => {
    // Ana owns VL7 and has no chat on it; Bob owns VL9, which she has no part in.
    const tasks = [
      task("vl7", [thread("c", { mine: false, person: "Bob", status: "working" })]),
      task("vl9"),
    ];
    expect(mine(ANA, tasks)).toEqual(["VL7"]);
    expect(mine(BOB, tasks)).toEqual(["VL9"]);
    expect(mine(CYRIL, tasks)).toEqual([]);
  });

  it("has a task you own through its area", () => {
    expect(mine(ANA, [task("vl10")])).toEqual(["VL10"]);
    expect(mine(CYRIL, [task("vl10")])).toEqual([]);
  });

  it("keeps what it had: your chats, and the tasks you created", () => {
    expect(mine(CYRIL, [task("vl10", [chat("c")])])).toEqual(["VL10"]);
    const created = ordering([task("vl10")], ownershipFor(CYRIL), {
      tasks: [hubTask("vl10", { area: "Payments", createdBy: CYRIL })],
    });
    expect(taskCards([created], { ...everyone, mine: true, me: CYRIL }).map(cardKey)).toEqual([
      "VL10",
    ]);
  });

  it("is what it was where ownership is off", () => {
    const off = ordering([task("vl7"), task("vl9")], undefined);
    expect(taskCards([off], { ...everyone, mine: true, me: ANA })).toEqual([]);
  });
});

describe("the owner on a task card", () => {
  it("says who owns the task and whether that is the person", () => {
    const cards = taskCards(
      [ordering([task("vl7"), task("vl9"), task("vl10")], ownershipFor(ANA))],
      { ...everyone, me: ANA },
    );
    expect(onlyTask(cards, "VL7").owner).toMatchObject({
      name: "Ana",
      mine: true,
      reason: "named",
    });
    expect(onlyTask(cards, "VL9").owner).toMatchObject({
      name: "Bob",
      mine: false,
      reason: "request",
    });
    expect(onlyTask(cards, "VL10").owner).toMatchObject({
      name: "Ana",
      mine: true,
      throughArea: "Payments",
    });
  });

  it("finds a task by its owner's name", () => {
    const cards = taskCards([ordering([task("vl7"), task("vl9")], ownershipFor(CYRIL))], {
      ...everyone,
      query: "bob",
    });
    expect(cards.map(cardKey)).toEqual(["VL9"]);
  });

  it("leaves the owner off while ownership is", () => {
    const [card] = taskCards([ordering([task("vl7")], undefined)], everyone);
    expect(card).toMatchObject({ kind: "task", owner: undefined, review: undefined });
  });
});

describe("owner's calls on the board", () => {
  const call: PeerOwnerCall = {
    id: "oc-1",
    project: "ordering",
    task: "vl9",
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
    expiresAt: iso(NOW + 6 * 86_400_000),
  };
  const item: NeedsYouItem = {
    kind: "owner-call",
    key: "owner-call:acme/ordering/oc-1",
    title: "Bob's agent asks to change your path",
    rank: 2,
    since: call.createdAt,
    environmentId: HERE,
    environmentLabel: "Laptop",
    offline: false,
    hubError: false,
    workspace: "acme",
    project: "ordering",
    call,
    asker: "Bob",
    owner: "Ana",
    onBehalf: false,
  };

  it("puts the call under Needs you on its task and project, in Mine, and finds it by what it says", () => {
    const tree = [
      ordering(
        [task("vl9", [thread("b", { mine: false, person: "Bob", status: "working" })])],
        ownershipFor(ANA),
      ),
    ];
    const cards = taskCards(tree, { ...everyone, needs: [item], me: ANA });
    const card = cards.find((candidate) => candidate.kind === "owner-call");
    expect(card).toMatchObject({
      column: "needs",
      key: "acme/ordering:owner-call:acme/ordering/oc-1",
    });
    expect(card?.task?.id).toBe("vl9");
    expect(card?.project.projectId).toBe("ordering");
    expect(taskCounts(tree[0]!, false, [item]).needs).toBe(1);
    const mine = taskCards(tree, { ...everyone, mine: true, needs: [item], me: ANA });
    expect(mine.map(cardKey)).toContain(item.key);
    for (const query of ["fees.ts", "refund fee", "bob"]) {
      expect(taskCards(tree, { ...everyone, needs: [item], query }).map(cardKey), query).toContain(
        item.key,
      );
    }
    expect(
      taskCards(tree, { ...everyone, needs: [item], query: "unrelated" }).map(cardKey),
    ).not.toContain(item.key);
  });

  it("stays under the project it is about", () => {
    const other: WorkProjectNode = {
      ...ordering([], ownershipFor(ANA)),
      projectId: "booking",
      name: "Booking",
    };
    const tree = [ordering([task("vl9")], ownershipFor(ANA)), other];
    expect(taskCards(tree, { ...everyone, scope: "acme/booking", needs: [item] })).toEqual([]);
    expect(
      taskCards(tree, { ...everyone, scope: "acme/ordering", needs: [item] }).map(cardKey),
    ).toContain(item.key);
  });
});

describe("the work tree", () => {
  const project = {
    id: "ordering",
    name: "Ordering demo",
    role: "lead" as const,
    members: MEMBERS,
    repositories: [],
    knowledge: { kontext: false, company: false },
    tools: [],
    capacity: { personal: "any" as const, personalHarnesses: [] },
  };
  const status = (ownership: PeerHubStatus["ownership"]): PeerHubStatus => ({
    hubUrl: "https://hub.example.test",
    signedIn: true,
    email: EVA,
    pendingSignIn: null,
    workspaces: [
      {
        slug: "acme",
        name: "Acme",
        role: "member",
        allowedDomains: [],
        currency: "EUR",
        memberName: "Eva",
        companyKnowledge: null,
        projects: [
          {
            project,
            repositories: [],
            tools: [],
            sharedCapacity: { enabled: false, instanceIds: [] },
            work: {
              areas: ["Payments"],
              tasks: [
                hubTask("vl9", { area: "Payments", status: "review", key: "VL9" }),
                hubTask("vl20", { status: "review", key: "VL20" }),
              ],
              threads: [],
            },
            peers: [],
          },
        ],
        lastSyncAt: null,
        error: null,
      },
    ],
    joinable: [],
    workspaceRoot: "/w",
    environmentId: HERE,
    agents: { herdr: "not-running", list: [] },
    github: { cli: false, account: null, signIn: null, error: null },
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
    sharedThreads: [],
    syncing: false,
    lastSyncAt: null,
    error: null,
    ...(ownership === undefined ? {} : { ownership }),
  });

  it("carries the project's ownership from the status, and routes reviews by it end to end", () => {
    const [node] = buildWorkTree({
      status: status({ projects: [{ ...view({ tasks: {} }), at: minutes(0) }] }),
      localThreads: [],
      now: NOW,
    });
    expect(node?.ownership?.me).toBe(EVA);
    expect(node?.ownership?.canManage).toBe(true);
    const cards = taskCards([node!], { ...everyone, me: EVA });
    // VL9 is in Payments, which Ana owns; VL20 sits in no owned area, so Eva, the lead, is asked.
    expect(onlyTask(cards, "VL9")).toMatchObject({ column: "working", owner: { name: "Ana" } });
    expect(onlyTask(cards, "VL20")).toMatchObject({ column: "needs", owner: undefined });
  });

  it("has none while the status holds none for the project", () => {
    expect(
      buildWorkTree({ status: status(undefined), localThreads: [], now: NOW })[0]?.ownership,
    ).toBeUndefined();
    const elsewhere = { projects: [{ ...view(), project: "booking" }] };
    expect(
      buildWorkTree({ status: status(elsewhere), localThreads: [], now: NOW })[0]?.ownership,
    ).toBeUndefined();
    const cards = taskCards(
      buildWorkTree({ status: status(undefined), localThreads: [], now: NOW }),
      everyone,
    );
    expect(inColumn(cards, "needs").toSorted()).toEqual(["VL20", "VL9"]);
  });
});
