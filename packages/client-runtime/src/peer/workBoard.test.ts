import { describe, expect, it } from "vite-plus/test";

import { EnvironmentId, ThreadId, type PeerHubStatus, type PeerTask } from "@t3tools/contracts";

import type { NeedsYouItem } from "./needsYou.ts";
import {
  agoInWords,
  ALL_PROJECTS,
  boardCards,
  boardColumn,
  doneLine,
  needProject,
  projectCounts,
  resolveScope,
  TASK_COLUMNS,
  TASK_STATES_NEEDING_YOU,
  taskCards,
  taskColumn,
  taskCounts,
  taskHandoff,
  taskPeople,
  taskTarget,
  taskWhy,
  unsortedChats,
  type BoardCard,
  type TaskCard,
  type TaskHandoff,
  type TaskState,
  type WorkProjectNode,
  type WorkTaskCard,
  type WorkTaskNode,
  type WorkThreadNode,
} from "./work.ts";

/** What a card is about: the thread's key, or the Needs you item's. */
const keyOf = (card: BoardCard) => (card.kind === "thread" ? card.thread.key : card.item.key);

function thread(overrides: Partial<WorkThreadNode> & Pick<WorkThreadNode, "key">): WorkThreadNode {
  return {
    title: overrides.key,
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

function task(
  id: string,
  threads: ReadonlyArray<WorkThreadNode>,
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

function project(
  projectId: string,
  tasks: ReadonlyArray<WorkTaskNode>,
  unsorted: ReadonlyArray<WorkThreadNode> = [],
  hubTasks: ReadonlyArray<PeerTask> = [],
): WorkProjectNode {
  return {
    workspace: "acme",
    workspaceName: "Acme",
    projectId,
    name: projectId,
    areas: [{ name: null, tasks }],
    unsorted,
    context: undefined,
    candidates: 0,
    tasks: hubTasks,
  };
}

describe("boardColumn", () => {
  it("places threads by what they wait for", () => {
    expect(boardColumn(thread({ key: "a", status: "blocked" }))).toBe("needs");
    expect(boardColumn(thread({ key: "b", status: "working" }))).toBe("working");
    expect(boardColumn(thread({ key: "c", status: "done" }))).toBe("review");
    expect(boardColumn(thread({ key: "d", status: "idle", delivery: "review" }))).toBe("review");
    expect(boardColumn(thread({ key: "e", status: "idle" }))).toBe("idle");
  });

  it("drops merged and closed work and shows a colleague who went quiet as idle", () => {
    expect(boardColumn(thread({ key: "a", status: "working", delivery: "merged" }))).toBeNull();
    expect(boardColumn(thread({ key: "b", delivery: "closed" }))).toBeNull();
    expect(boardColumn(thread({ key: "c", mine: false, status: "unknown", stale: true }))).toBe(
      "idle",
    );
  });
});

describe("boardCards", () => {
  const tree = [
    project("booking", [
      task("bkg-1", [
        thread({ key: "mine", status: "blocked", branch: "bkg-1-opera" }),
        thread({ key: "eva", mine: false, person: "Eva", status: "working" }),
      ]),
    ]),
    project("hub", [], [thread({ key: "loose", status: "working" })]),
  ];

  it("keeps one project when a project is in scope", () => {
    const keys = boardCards(tree, { scope: "acme/hub", mine: false, query: "" }).map(keyOf);
    expect(keys).toEqual(["loose"]);
  });

  it("shows only your threads when asked and finds by branch, person or task key", () => {
    expect(boardCards(tree, { scope: ALL_PROJECTS, mine: true, query: "" }).map(keyOf)).toEqual([
      "loose",
      "mine",
    ]);
    expect(
      boardCards(tree, { scope: ALL_PROJECTS, mine: false, query: "OPERA" }).map(keyOf),
    ).toEqual(["mine"]);
    expect(boardCards(tree, { scope: ALL_PROJECTS, mine: false, query: "eva" }).map(keyOf)).toEqual(
      ["eva"],
    );
    expect(boardCards(tree, { scope: ALL_PROJECTS, mine: false, query: "bkg-1" }).length).toBe(2);
  });

  it("keeps the task a card is on", () => {
    const [card] = boardCards(tree, { scope: "acme/booking", mine: true, query: "" });
    expect(card?.task?.key).toBe("BKG-1");
  });
});

describe("projectCounts and resolveScope", () => {
  const booking = project("booking", [
    task("bkg-1", [
      thread({ key: "a", status: "blocked" }),
      thread({ key: "b", mine: false, status: "working" }),
      thread({ key: "c", status: "done", delivery: "merged" }),
    ]),
  ]);

  it("counts threads per column, everyone's or yours", () => {
    expect(projectCounts(booking)).toEqual({ needs: 1, working: 1, review: 0, idle: 0 });
    expect(projectCounts(booking, true)).toEqual({ needs: 1, working: 0, review: 0, idle: 0 });
  });

  it("falls back to all projects when the chosen one is gone", () => {
    expect(resolveScope("acme/booking", [booking])).toBe("acme/booking");
    expect(resolveScope("acme/gone", [booking])).toBe(ALL_PROJECTS);
  });
});

const HERE = EnvironmentId.make("env-here");
const base = {
  environmentId: HERE,
  environmentLabel: "This Mac",
  offline: false,
  hubError: false,
};
const request: NeedsYouItem = {
  ...base,
  kind: "request",
  key: "request:acme:r1",
  title: "Rerun the camp import",
  rank: 2,
  since: "2026-10-10T10:00:00Z",
  workspace: "acme",
  request: {
    id: "r1",
    project: "booking",
    task: "bkg-1",
    sender: "vir@acme.test",
    recipient: "you@acme.test",
    title: "Rerun the camp import",
    prompt: "The 2025 mapping is fixed on main.",
    status: "pending",
    createdAt: "2026-10-10T10:00:00Z",
    updatedAt: "2026-10-10T10:00:00Z",
  },
  computers: [],
};
const overlap: NeedsYouItem = {
  ...base,
  kind: "overlap",
  key: "overlap:acme:hub:o1",
  title: "server/routes.rs",
  rank: 3,
  since: "2026-10-10T10:05:00Z",
  overlap: {
    id: "o1",
    workspace: "acme",
    project: "hub",
    sessions: ["claude:a", "claude:b"],
    files: ["server/routes.rs"],
    state: "open",
    notes: [],
    updatedAt: "2026-10-10T10:05:00Z",
  },
  phase: "decide",
  participants: ["You", "Ana"],
  computers: [],
};
const stale: NeedsYouItem = {
  ...base,
  kind: "stale",
  key: "stale:env-here:claude:a",
  title: "BKG-1: Task bkg-1",
  rank: 4,
  since: "2026-10-10T09:00:00Z",
  stale: { session: "claude:a", since: "2026-10-10T09:00:00Z", scopes: [] },
  session: {
    id: "claude:a",
    workspace: "acme",
    project: "booking",
    email: "you@acme.test",
    label: "OPERA integration",
    task: "bkg-1",
    status: "idle",
    files: [],
    claims: [],
    local: true,
  },
  open: {
    kind: "context",
    environmentId: HERE,
    workspace: "acme",
    project: "booking",
    scope: "task:bkg-1",
  },
};

describe("Needs you column", () => {
  const waiting = thread({
    key: "peer:t1",
    status: "blocked",
    open: { kind: "thread", environmentId: HERE, threadId: ThreadId.make("t1") },
  });
  const approval: NeedsYouItem = {
    ...base,
    kind: "thread",
    key: "thread:env-here:t1",
    title: "OPERA integration",
    rank: 0,
    since: "2026-10-10T10:10:00Z",
    need: "approval",
    thread: {} as Extract<NeedsYouItem, { kind: "thread" }>["thread"],
    open: { kind: "thread", environmentId: HERE, threadId: ThreadId.make("t1") },
  };
  const tree = [
    project("booking", [
      task("bkg-1", [
        waiting,
        thread({ key: "eva", mine: false, person: "Eva", status: "blocked" }),
      ]),
    ]),
    project("hub", [task("hub-1", [thread({ key: "ana", mine: false, status: "working" })])]),
  ];
  const needs = [approval, request, overlap, stale];
  const all = boardCards(tree, { scope: ALL_PROJECTS, mine: false, query: "", needs });
  const column = (key: string) => all.find((card) => keyOf(card) === key)?.column;

  it("puts your waiting thread under Needs you and a colleague's under Working, waiting on them", () => {
    expect(column("peer:t1")).toBe("needs");
    const eva = all.find((card) => keyOf(card) === "eva");
    expect(eva?.column).toBe("working");
    expect(eva?.kind === "thread" ? eva.waitingOn : null).toBe("Eva");
  });

  it("says what your thread waits for and adds no second card for it", () => {
    const mine = all.filter((card) => keyOf(card) === "peer:t1" || keyOf(card) === approval.key);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.kind === "thread" ? mine[0].need : null).toBe("approval");
  });

  it("adds a card for a request, an overlap and stale inputs, each on its project", () => {
    expect(all.filter((card) => card.column === "needs").map(keyOf)).toEqual([
      "peer:t1",
      request.key,
      overlap.key,
      stale.key,
    ]);
    const requestCard = all.find((card) => card.kind === "request");
    expect(requestCard?.project.projectId).toBe("booking");
    expect(requestCard?.task?.key).toBe("BKG-1");
    expect(all.find((card) => card.kind === "overlap")?.project.projectId).toBe("hub");
    expect(all.find((card) => card.kind === "stale")?.task?.id).toBe("bkg-1");
  });

  it("keeps only the scoped project's cards", () => {
    const hub = boardCards(tree, { scope: "acme/hub", mine: false, query: "", needs });
    expect(hub.map(keyOf)).toEqual([overlap.key, "ana"]);
    const booking = boardCards(tree, { scope: "acme/booking", mine: false, query: "", needs });
    expect(booking.map(keyOf)).not.toContain(overlap.key);
    expect(booking.map(keyOf)).toContain(request.key);
  });

  it("keeps request, overlap and stale cards under Mine and leaves colleagues out", () => {
    const mine = boardCards(tree, { scope: ALL_PROJECTS, mine: true, query: "", needs });
    expect(mine.map(keyOf)).toEqual(["peer:t1", request.key, overlap.key, stale.key]);
  });

  it("finds a request by its sender and counts what needs you per project", () => {
    expect(
      boardCards(tree, { scope: ALL_PROJECTS, mine: false, query: "vir@", needs }).map(keyOf),
    ).toEqual([request.key]);
    expect(projectCounts(tree[0]!, false, needs)).toEqual({
      needs: 3,
      working: 1,
      review: 0,
      idle: 0,
    });
  });

  it("places stale inputs on the project of the session that read them", () => {
    expect(needProject(stale, new Map())).toBe("acme/booking");
  });
});

// ── The board by task ─────────────────────────────────────────────────────────────────────────

/** A chat Peer can open, as the tree keys it. */
function chat(
  key: string,
  overrides: Partial<WorkThreadNode> = {},
): WorkThreadNode & { readonly open: NonNullable<WorkThreadNode["open"]> } {
  return {
    ...thread({ key }),
    open: { kind: "thread", environmentId: HERE, threadId: ThreadId.make(key) },
    ...overrides,
  } as WorkThreadNode & { readonly open: NonNullable<WorkThreadNode["open"]> };
}

/** A colleague's chat: Peer can't open it here. */
const colleague = (key: string, person: string, overrides: Partial<WorkThreadNode> = {}) =>
  thread({ key, mine: false, person, ...overrides });

/** What a card is about: the task's key, or the Needs you item's. */
const cardKey = (card: TaskCard) => (card.kind === "task" ? (card.task.key ?? "") : card.item.key);
const inColumn = (cards: ReadonlyArray<TaskCard>, column: TaskCard["column"]) =>
  cards.filter((card) => card.column === column).map(cardKey);

function onlyTask(cards: ReadonlyArray<TaskCard>, key: string): WorkTaskCard {
  const card = cards.find((candidate) => cardKey(candidate) === key);
  if (card?.kind !== "task") throw new Error(`no task card ${key}`);
  return card;
}

function hubTask(id: string, overrides: Partial<PeerTask> = {}): PeerTask {
  return {
    id,
    title: `Task ${id}`,
    status: "open",
    createdBy: "colleague@acme.test",
    createdAt: "2026-10-01T09:00:00Z",
    updatedAt: "2026-10-01T09:00:00Z",
    ...overrides,
  };
}

const state = (kind: TaskState["kind"]): TaskState => ({
  kind,
  label: kind,
  waitingOn: undefined,
});

describe("taskColumn", () => {
  it("puts a task where its state says, and a done task nowhere", () => {
    expect(taskColumn(state("done"))).toBeNull();
    expect(taskColumn(state("review"))).toBe("needs");
    expect(taskColumn(state("approval"))).toBe("needs");
    expect(taskColumn(state("input"))).toBe("needs");
    expect(taskColumn(state("working"))).toBe("working");
    expect(taskColumn({ kind: "waiting", label: "Waiting on Ana", waitingOn: "Ana" })).toBe(
      "working",
    );
    expect(taskColumn(state("paused"))).toBe("paused");
    expect(taskColumn(state("new"))).toBe("new");
  });

  it("keeps every state that waits on the person under Needs you", () => {
    for (const kind of TASK_STATES_NEEDING_YOU) expect(taskColumn(state(kind))).toBe("needs");
  });

  it("titles the columns as the board does, Needs you first", () => {
    expect(TASK_COLUMNS.map((column) => column.title)).toEqual([
      "Needs you",
      "In progress",
      "Paused",
      "Not started",
    ]);
  });
});

describe("taskCards", () => {
  const everyone = { scope: ALL_PROJECTS, mine: false, query: "" };

  it("puts review tasks with idle chats under Needs you and in no other column", () => {
    const tree = [
      project("ordering", [
        task("ord-1", [chat("a")], { inReview: true }),
        task("ord-4", [colleague("b", "Eva")], { inReview: true }),
        task("ord-7", [chat("c"), colleague("d", "Ana")], { inReview: true }),
      ]),
    ];
    const cards = taskCards(tree, everyone);
    expect(inColumn(cards, "needs").toSorted()).toEqual(["ORD-1", "ORD-4", "ORD-7"]);
    for (const column of ["working", "paused", "new", null] as const) {
      expect(inColumn(cards, column)).toEqual([]);
    }
    expect(cards.map((card) => (card.kind === "task" ? card.action?.label : null))).toEqual([
      "Review",
      "Review",
      "Review",
    ]);
  });

  it("reads a task handed off while its agent still works as waiting for review", () => {
    const tree = [
      project("ordering", [task("ord-7", [chat("a", { status: "working" })], { inReview: true })]),
    ];
    const card = onlyTask(taskCards(tree, everyone), "ORD-7");
    expect(card.state.label).toBe("Waiting for review");
    expect(card.column).toBe("needs");
  });

  it("places the other tasks by what their chats do", () => {
    const tree = [
      project("ordering", [
        task("ord-2", [colleague("a", "Ana", { status: "working" })]),
        task("ord-3", [chat("b", { status: "blocked" })]),
        task("ord-6", [colleague("c", "Eva", { status: "blocked" })]),
        task("rec-2", [chat("d", { status: "idle" })]),
        task("ord-5", []),
      ]),
    ];
    const cards = taskCards(tree, everyone);
    expect(inColumn(cards, "needs")).toEqual(["ORD-3"]);
    expect(inColumn(cards, "working").toSorted()).toEqual(["ORD-2", "ORD-6"]);
    expect(onlyTask(cards, "ORD-6").state.label).toBe("Waiting on Eva");
    expect(inColumn(cards, "paused")).toEqual(["REC-2"]);
    expect(inColumn(cards, "new")).toEqual(["ORD-5"]);
  });

  it("returns a done task with no column, so it is on no column of the board", () => {
    const tree = [
      project("ordering", [
        task("ord-8", [chat("a", { delivery: "merged" })], { status: "done" }),
        task("ord-9", [chat("b")], { done: true }),
      ]),
    ];
    const cards = taskCards(tree, everyone);
    expect(cards.map(cardKey).toSorted()).toEqual(["ORD-8", "ORD-9"]);
    expect(cards.every((card) => card.column === null)).toBe(true);
  });

  it("tells an approval from an answer and opens the chat that waits", () => {
    const answering = chat("a", { status: "blocked" });
    const approving = chat("b", { status: "blocked" });
    const tree = [project("ordering", [task("ord-3", [answering]), task("ord-4", [approving])])];
    const needs: NeedsYouItem[] = [
      {
        ...base,
        kind: "thread",
        key: "thread:env-here:b",
        title: "b",
        rank: 0,
        since: "2026-10-10T10:10:00Z",
        need: "approval",
        thread: {} as Extract<NeedsYouItem, { kind: "thread" }>["thread"],
        open: approving.open,
      },
    ];
    const cards = taskCards(tree, { ...everyone, needs });
    expect(onlyTask(cards, "ORD-3").action).toEqual({
      label: "Answer",
      target: { kind: "chat", open: answering.open },
    });
    expect(onlyTask(cards, "ORD-4").state.label).toBe("Needs your approval");
    expect(onlyTask(cards, "ORD-4").action).toEqual({
      label: "Approve",
      target: { kind: "chat", open: approving.open },
    });
  });

  it("asks nothing of the person for a task that does not wait on them", () => {
    const tree = [project("ordering", [task("ord-2", [chat("a", { status: "working" })])])];
    expect(onlyTask(taskCards(tree, everyone), "ORD-2").action).toBeUndefined();
  });

  it("keeps request, overlap and stale cards under Needs you beside the tasks that wait", () => {
    const tree = [
      project("booking", [
        task("bkg-1", [chat("a", { status: "blocked" })]),
        task("bkg-2", [colleague("b", "Ana", { status: "working" })]),
      ]),
      project("hub", []),
    ];
    const cards = taskCards(tree, { ...everyone, needs: [request, overlap, stale] });
    expect(inColumn(cards, "needs").toSorted()).toEqual(
      ["BKG-1", request.key, overlap.key, stale.key].toSorted(),
    );
    expect(inColumn(cards, "working")).toEqual(["BKG-2"]);
    expect(cards.find((card) => card.kind === "request")?.task?.key).toBe("BKG-1");
    expect(cards.find((card) => card.kind === "overlap")?.project.projectId).toBe("hub");
    expect(cards.find((card) => card.kind === "stale")?.project.projectId).toBe("booking");
  });

  it("scopes to one project and keeps the cards that concern it", () => {
    const tree = [
      project("booking", [task("bkg-1", [chat("a")])]),
      project("hub", [task("hub-1", [chat("b")])]),
    ];
    const needs = [request, overlap];
    const keys = (scope: string) =>
      taskCards(tree, { scope, mine: false, query: "", needs }).map(cardKey).toSorted();
    expect(keys("acme/hub")).toEqual(["HUB-1", overlap.key].toSorted());
    expect(keys("acme/booking")).toEqual(["BKG-1", request.key].toSorted());
  });

  it("lists yours first, then what waits first, then the latest activity", () => {
    const tree = [
      project("ordering", [
        task("ord-4", [colleague("a", "Eva")], { inReview: true }),
        task("ord-1", [chat("b", { activeAt: "2026-10-10T08:00:00Z" })], { inReview: true }),
        task("ord-7", [chat("c", { activeAt: "2026-10-10T12:00:00Z" })], { inReview: true }),
        task("ord-3", [chat("d", { status: "blocked" })]),
      ]),
    ];
    expect(inColumn(taskCards(tree, everyone), "needs")).toEqual([
      "ORD-3",
      "ORD-7",
      "ORD-1",
      "ORD-4",
    ]);
  });

  describe("what a task card carries", () => {
    const orders = (taskNode: WorkTaskNode, hub: ReadonlyArray<PeerTask> = []) => {
      const one = project("ordering", [], [], hub);
      return { ...one, areas: [{ name: "Orders", tasks: [taskNode] }] };
    };

    it("has its area, or none", () => {
      const named = taskCards([orders(task("ord-7", []))], everyone);
      expect(onlyTask(named, "ORD-7").area).toBe("Orders");
      const loose = taskCards([project("ordering", [task("ord-5", [])])], everyone);
      expect(onlyTask(loose, "ORD-5").area).toBeNull();
    });

    it("counts everyone's chats and lists the people on them", () => {
      const chats = [chat("a", { person: "Slavo" }), colleague("b", "Ana"), colleague("c", "Ana")];
      const card = onlyTask(taskCards([orders(task("ord-7", chats))], everyone), "ORD-7");
      expect(card.chats).toBe(3);
      expect(card.people).toEqual([
        { name: "Slavo", mine: true },
        { name: "Ana", mine: false },
      ]);
    });

    it("was last touched when the Hub or one of its chats here said so last", () => {
      const touched = (hub: string, chatAt: string | undefined) =>
        onlyTask(
          taskCards(
            [
              orders(task("ord-7", [chat("a", { activeAt: chatAt })]), [
                hubTask("ord-7", { updatedAt: hub }),
              ]),
            ],
            everyone,
          ),
          "ORD-7",
        ).updatedAt;
      expect(touched("2026-10-10T12:30:00Z", "2026-10-10T11:00:00Z")).toBe("2026-10-10T12:30:00Z");
      expect(touched("2026-10-10T09:00:00Z", "2026-10-10T11:00:00Z")).toBe("2026-10-10T11:00:00Z");
      expect(touched("2026-10-10T09:00:00Z", undefined)).toBe("2026-10-10T09:00:00Z");
    });
  });

  describe("Mine and the search", () => {
    const tree = [
      {
        ...project(
          "ordering",
          [],
          [],
          [
            hubTask("ord-5", { createdBy: "you@acme.test" }),
            hubTask("ord-6", { createdBy: "ana@acme.test" }),
          ],
        ),
        areas: [
          {
            name: "Orders",
            tasks: [
              task("ord-1", [chat("a", { status: "working", branch: "ord-1-split" })]),
              task("ord-2", [colleague("b", "Ana", { status: "working" })]),
              task("ord-4", [colleague("c", "Eva")], { inReview: true }),
            ],
          },
          { name: null, tasks: [task("ord-5", []), task("ord-6", [])] },
        ],
      },
    ];
    const find = (query: string) =>
      taskCards(tree, { scope: ALL_PROJECTS, mine: false, query }).map(cardKey).toSorted();

    it("keeps the tasks with a chat of yours, those you created and every Needs you card", () => {
      const mine = taskCards(tree, {
        scope: ALL_PROJECTS,
        mine: true,
        query: "",
        me: "you@acme.test",
      });
      expect(mine.map(cardKey).toSorted()).toEqual(["ORD-1", "ORD-4", "ORD-5"]);
    });

    it("keeps only the tasks with a chat of yours when it does not know who you are", () => {
      const mine = taskCards(tree, { scope: ALL_PROJECTS, mine: true, query: "" });
      expect(mine.map(cardKey).toSorted()).toEqual(["ORD-1", "ORD-4"]);
    });

    it("finds a task by its key, title, branch, area, a person, or the state it reads", () => {
      expect(find("ORD-5")).toEqual(["ORD-5"]);
      expect(find("task ord-6")).toEqual(["ORD-6"]);
      expect(find("split")).toEqual(["ORD-1"]);
      expect(find("orders")).toEqual(["ORD-1", "ORD-2", "ORD-4"]);
      expect(find("no area")).toEqual(["ORD-5", "ORD-6"]);
      expect(find("ana")).toEqual(["ORD-2"]);
      expect(find("waiting for review")).toEqual(["ORD-4"]);
    });

    it("finds a request by its sender", () => {
      const booking = [project("booking", [task("bkg-1", [])])];
      const keys = (query: string) =>
        taskCards(booking, { scope: ALL_PROJECTS, mine: false, query, needs: [request] }).map(
          cardKey,
        );
      expect(keys("vir@")).toEqual([request.key]);
    });
  });
});

describe("taskCounts", () => {
  const booking = project("booking", [
    task("bkg-1", [chat("a", { status: "blocked" })]),
    task("bkg-2", [colleague("b", "Ana", { status: "working" })]),
    task("bkg-3", [chat("c")], { inReview: true }),
    task("bkg-4", [chat("d")]),
    task("bkg-5", []),
    task("bkg-6", [chat("e")], { done: true }),
  ]);

  it("counts the cards per column, the active tasks and the done ones", () => {
    expect(taskCounts(booking)).toEqual({
      needs: 2,
      working: 1,
      paused: 1,
      new: 1,
      active: 5,
      done: 1,
    });
  });

  it("counts requests, overlaps and stale inputs under Needs you, but not as tasks", () => {
    const counts = taskCounts(booking, false, [request, stale]);
    expect(counts.needs).toBe(4);
    expect(counts.active).toBe(5);
  });

  it("counts only yours, and every card under Needs you", () => {
    expect(taskCounts(booking, true)).toEqual({
      needs: 2,
      working: 0,
      paused: 1,
      new: 0,
      active: 3,
      done: 1,
    });
  });

  it("counts what the board lists under Needs you", () => {
    const tree = [booking, project("hub", [task("hub-1", [chat("f")], { inReview: true })])];
    const needs = [request, overlap, stale];
    const listed = taskCards(tree, { scope: ALL_PROJECTS, mine: false, query: "", needs }).filter(
      (card) => card.column === "needs",
    );
    const counted = tree.reduce((sum, one) => sum + taskCounts(one, false, needs).needs, 0);
    expect(counted).toBe(listed.length);
  });
});

describe("taskTarget", () => {
  const target = (taskNode: WorkTaskNode) =>
    taskTarget({
      project: project("ordering", [taskNode]),
      task: taskNode,
      state: state(taskNode.inReview === true ? "review" : "paused"),
    });

  it("opens the review of a task that waits for one, whatever its chats do", () => {
    expect(target(task("ord-7", [chat("a", { status: "working" })], { inReview: true }))).toEqual({
      kind: "review",
      workspace: "acme",
      project: "ordering",
      task: "ord-7",
    });
  });

  it("opens the first chat of yours that Peer can open", () => {
    const own = chat("b");
    const unopenable = thread({ key: "x" });
    expect(target(task("ord-2", [colleague("a", "Ana"), unopenable, own]))).toEqual({
      kind: "chat",
      open: own.open,
    });
  });

  it("opens nothing for a task with no chat of yours to open", () => {
    expect(target(task("ord-5", []))).toBeNull();
    expect(target(task("ord-4", [colleague("a", "Eva")]))).toBeNull();
  });
});

describe("taskPeople", () => {
  it("lists each person once, you first", () => {
    const people = taskPeople(
      task("ord-7", [colleague("a", "Ana"), chat("b", { person: "Slavo" }), colleague("c", "Ana")]),
    );
    expect(people).toEqual([
      { name: "Slavo", mine: true },
      { name: "Ana", mine: false },
    ]);
  });

  it("lists nobody for a task with no chat", () => {
    expect(taskPeople(task("ord-5", []))).toEqual([]);
  });
});

describe("taskWhy", () => {
  const names = (node: WorkThreadNode) =>
    node.agent !== undefined && "harness" in node.agent ? node.agent.harness : undefined;
  const claude = { harness: "Claude" } as const;
  const codex = { harness: "Codex" } as const;
  const why = (
    taskNode: WorkTaskNode,
    kind: TaskState["kind"],
    extra: { handoff?: TaskHandoff; waitingOn?: string; updatedAt?: string } = {},
  ) =>
    taskWhy(
      {
        task: taskNode,
        state: { kind, label: kind, waitingOn: extra.waitingOn },
        updatedAt: extra.updatedAt,
        chats: taskNode.threads.length,
      },
      { handoff: extra.handoff, agentName: names },
    );
  const handoff = (overrides: Partial<TaskHandoff> = {}): TaskHandoff => ({
    number: 2,
    author: "Slavo",
    mine: true,
    byAgent: true,
    at: "2026-10-10T10:00:00Z",
    ...overrides,
  });

  it("names the agent and the chat a handoff came from, and when", () => {
    const mine = task("ord-7", [chat("a", { agent: claude }), colleague("b", "Ana")]);
    expect(why(mine, "review", { handoff: handoff() })).toEqual({
      text: "Handoff #2 from Claude in your chat",
      at: "2026-10-10T10:00:00Z",
    });
    const eva = task("ord-4", [colleague("c", "Eva", { agent: claude })]);
    const fromEva = handoff({ number: 1, author: "Eva", mine: false });
    expect(why(eva, "review", { handoff: fromEva }).text).toBe(
      "Handoff #1 from Claude in Eva’s chat",
    );
  });

  it("names the person when it can't tell the agent, and when a person composed it", () => {
    const two = task("ord-7", [chat("a", { agent: claude }), chat("b", { agent: codex })]);
    expect(why(two, "review", { handoff: handoff() }).text).toBe("Handoff #2 from you");
    const one = task("ord-1", [chat("a", { agent: claude })]);
    expect(why(one, "review", { handoff: handoff({ byAgent: false }) }).text).toBe(
      "Handoff #2 from you",
    );
    const fromAna = handoff({ author: "Ana", mine: false });
    expect(why(one, "review", { handoff: fromAna }).text).toBe("Handoff #2 from Ana");
  });

  it("says a handoff waits when the Hub reports none", () => {
    expect(why(task("ord-7", [chat("a")]), "review")).toEqual({
      text: "A handoff waits for your review",
      at: undefined,
    });
  });

  it("says what the agent waits for in your chat", () => {
    const waiting = task("ord-3", [
      chat("a", { status: "blocked", agent: claude, activeAt: "2026-10-10T11:00:00Z" }),
    ]);
    expect(why(waiting, "input")).toEqual({
      text: "Claude asks you a question",
      at: "2026-10-10T11:00:00Z",
    });
    expect(why(waiting, "approval").text).toBe("Claude needs your approval");
    expect(why(task("ord-3", [chat("b", { status: "blocked" })]), "input").text).toBe(
      "A chat of yours asks you a question",
    );
  });

  it("says whose chat works, and how many more", () => {
    const ana = task("ord-2", [colleague("a", "Ana", { status: "working", agent: codex })]);
    expect(why(ana, "working").text).toBe("Codex is working in Ana’s chat");
    const two = task("ord-6", [
      chat("b", { status: "working", agent: claude }),
      colleague("c", "Eva", { status: "working" }),
    ]);
    expect(why(two, "working").text).toBe("Claude is working in your chat and 1 more");
    expect(why(task("ord-8", [chat("d", { status: "working" })]), "working").text).toBe(
      "Working in your chat",
    );
  });

  it("says a colleague's chat waits for its owner", () => {
    const eva = task("ord-6", [colleague("a", "Eva", { status: "blocked", agent: claude })]);
    expect(why(eva, "waiting", { waitingOn: "Eva" }).text).toBe(
      "Claude in Eva’s chat waits for an answer or an approval",
    );
  });

  it("says why a task is paused or not started", () => {
    const paused = why(task("rec-2", [chat("a")]), "paused", { updatedAt: "2026-10-08T10:00:00Z" });
    expect(paused).toEqual({
      text: "Its chat stopped without a handoff",
      at: "2026-10-08T10:00:00Z",
    });
    expect(why(task("rec-3", [chat("a"), chat("b")]), "paused").text).toBe(
      "Its chats stopped without a handoff",
    );
    expect(why(task("ord-5", []), "new").text).toBe(
      "No chat yet. Start one, or request a teammate.",
    );
  });
});

describe("taskHandoff", () => {
  const status = (summaries: NonNullable<PeerHubStatus["handoff"]>["summaries"]) =>
    ({
      email: "you@acme.test",
      workspaces: [],
      handoff: { target: "none", projectTargets: {}, summaries, deliveries: [] },
    }) as unknown as PeerHubStatus;
  const summary = (number: number, author: string, overrides = {}) => ({
    workspace: "acme",
    project: "ordering",
    task: "ord-7",
    author,
    number,
    composedAt: `2026-10-0${number}T10:00:00Z`,
    contextVersion: 1,
    pullRequests: 0,
    source: "agent" as const,
    ...overrides,
  });
  const place = { workspace: "acme", projectId: "ordering" };

  it("takes the highest numbered handoff of the task", () => {
    const summaries = [
      summary(1, "you@acme.test"),
      summary(3, "ana@acme.test"),
      summary(2, "you@acme.test"),
    ];
    expect(taskHandoff(status(summaries), place, { id: "ord-7" })).toEqual({
      number: 3,
      author: "Ana",
      mine: false,
      byAgent: true,
      at: "2026-10-03T10:00:00Z",
    });
  });

  it("knows a handoff of yours and one a person composed", () => {
    const own = taskHandoff(status([summary(1, "you@acme.test", { source: "person" })]), place, {
      id: "ord-7",
    });
    expect(own?.mine).toBe(true);
    expect(own?.byAgent).toBe(false);
  });

  it("has none for another task, another project, or a Hub that reports no handoffs", () => {
    const summaries = [summary(1, "you@acme.test")];
    expect(taskHandoff(status(summaries), place, { id: "ord-1" })).toBeUndefined();
    expect(
      taskHandoff(status(summaries), { ...place, projectId: "hub" }, { id: "ord-7" }),
    ).toBeUndefined();
    const older = { email: "you@acme.test", workspaces: [] } as unknown as PeerHubStatus;
    expect(taskHandoff(older, place, { id: "ord-7" })).toBeUndefined();
  });
});

describe("unsortedChats", () => {
  const tree = [
    project(
      "booking",
      [],
      [
        chat("a", { title: "Spike the importer" }),
        chat("b", { title: "Delivered", delivery: "merged" }),
        chat("c", { title: "Closed", delivery: "closed" }),
        colleague("d", "Ana", { title: "Ana's spike" }),
        chat("e", { title: "Fix the footer", branch: "footer-fix" }),
      ],
    ),
    project("hub", [], [chat("f", { title: "Routes" })]),
  ];

  it("counts your chats on no task that are not delivered, in scope", () => {
    expect(unsortedChats(tree, { scope: ALL_PROJECTS })).toBe(3);
    expect(unsortedChats(tree, { scope: "acme/booking" })).toBe(2);
    expect(unsortedChats(tree, { scope: "acme/hub" })).toBe(1);
  });

  it("narrows with the search by title, branch or project", () => {
    expect(unsortedChats(tree, { scope: ALL_PROJECTS, query: "footer" })).toBe(1);
    expect(unsortedChats(tree, { scope: ALL_PROJECTS, query: " HUB " })).toBe(1);
    expect(unsortedChats(tree, { scope: ALL_PROJECTS, query: "nothing like it" })).toBe(0);
  });
});

describe("the done line", () => {
  const NOW = Date.parse("2026-10-12T12:00:00Z");
  const done = (updatedAt: string | undefined) => ({ updatedAt });

  it("says how long ago in words", () => {
    expect(agoInWords(NOW - 20_000, NOW)).toBe("just now");
    expect(agoInWords(NOW - 14 * 60_000, NOW)).toBe("14 min ago");
    expect(agoInWords(NOW - 3 * 3_600_000, NOW)).toBe("3 h ago");
    expect(agoInWords(NOW - 30 * 3_600_000, NOW)).toBe("yesterday");
    expect(agoInWords(NOW - 5 * 86_400_000, NOW)).toBe("5 days ago");
    expect(agoInWords(NOW - 21 * 86_400_000, NOW)).toBe("3 weeks ago");
    expect(agoInWords(NOW - 90 * 86_400_000, NOW)).toBe("3 months ago");
  });

  it("names how many are done and when the last one was", () => {
    const two = [done("2026-10-10T09:00:00Z"), done("2026-10-11T08:00:00Z")];
    expect(doneLine(two, NOW)).toBe("Done: 2 tasks, the last one yesterday");
    expect(doneLine([done("2026-10-12T09:00:00Z")], NOW)).toBe("Done: 1 task, finished 3 h ago");
  });

  it("has no line without a done task, and leaves the time out when none is known", () => {
    expect(doneLine([], NOW)).toBeNull();
    expect(doneLine([done(undefined), done(undefined)], NOW)).toBe("Done: 2 tasks");
  });
});
