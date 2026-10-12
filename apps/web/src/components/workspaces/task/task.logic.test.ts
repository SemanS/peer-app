import { EnvironmentId, ThreadId, type PeerHubStatus, type PeerTask } from "@t3tools/contracts";
import { openKey, type AgentNeed } from "@t3tools/client-runtime/peer/work";
import { describe, expect, it } from "vite-plus/test";

import type {
  WorkContextNode,
  WorkProjectNode,
  WorkTaskNode,
  WorkThreadNode,
} from "../workTree.logic";
import { taskMeta, taskPageModel, taskStateLook, type TaskPageModel } from "./task.logic";
import { chatState } from "./taskChats.logic";

const HERE = EnvironmentId.make("env-here");
// Local calendar dates, so the labels do not depend on the machine's zone.
const NOW = new Date(2026, 9, 12, 14, 30).getTime();
const MIN = 60_000;
const HOUR = 60 * MIN;
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const CREATED = new Date(2026, 9, 10, 16, 20).toISOString();
const IDS = { workspace: "acme", project: "orders", task: "ord-7" };

function thread(overrides: Partial<WorkThreadNode> & Pick<WorkThreadNode, "key">): WorkThreadNode {
  return {
    title: overrides.key,
    person: "Slavo",
    mine: true,
    status: "idle",
    delivery: "open",
    localEnvironment: true,
    harness: undefined,
    branch: undefined,
    source: "peer",
    stale: false,
    open: { kind: "thread", environmentId: HERE, threadId: ThreadId.make(overrides.key) },
    placeable: true,
    concerns: undefined,
    observable: false,
    agent: undefined,
    activeAt: undefined,
    keepsContext: false,
    ...overrides,
  };
}

/** Ana's chat on her own computer, as the tree places a colleague's. */
const anasChat = (overrides: Partial<WorkThreadNode> = {}) =>
  thread({
    key: "ana-laptop:peer:t9",
    title: "Order notes copy",
    person: "Ana",
    mine: false,
    status: "working",
    harness: "codex",
    localEnvironment: false,
    open: undefined,
    placeable: false,
    ...overrides,
  });

function context(overrides: Partial<WorkContextNode> = {}): WorkContextNode {
  return {
    workspace: "acme",
    project: "orders",
    scope: "task:ord-7",
    version: 4,
    gist: undefined,
    tokens: 800,
    keeper: { person: "Slavo", mine: true, session: "claude:1", label: "Claude", since: "" },
    updatedAt: ago(40 * MIN),
    updatedBy: "Ana",
    restoredFrom: undefined,
    reports: [],
    ...overrides,
  };
}

function taskNode(
  threads: ReadonlyArray<WorkThreadNode>,
  overrides: Partial<WorkTaskNode> = {},
): WorkTaskNode {
  return {
    id: "ord-7",
    key: "ORD-7",
    title: "Order notes header",
    done: false,
    status: "idle",
    threads,
    removable: true,
    context: undefined,
    ...overrides,
  };
}

function hubTask(overrides: Partial<PeerTask> = {}): PeerTask {
  return {
    id: "ord-7",
    key: "ORD-7",
    title: "Order notes header",
    area: "Orders",
    status: "open",
    createdBy: "slavo@acme.test",
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  };
}

function projectNode(
  task: WorkTaskNode,
  hub: PeerTask = hubTask(),
  area: string | null = "Orders",
): WorkProjectNode {
  return {
    workspace: "acme",
    workspaceName: "Acme",
    projectId: "orders",
    name: "Orders",
    areas: [{ name: area, tasks: [task] }],
    unsorted: [],
    context: undefined,
    candidates: 0,
    tasks: [hub],
  };
}

const summary = (number: number, minutesAgo: number, contextVersion: number | null) => ({
  workspace: "acme",
  project: "orders",
  task: "ord-7",
  author: "slavo@acme.test",
  number,
  composedAt: ago(minutesAgo * MIN),
  contextVersion,
  pullRequests: 0,
  source: "agent" as const,
});

function status(
  options: {
    readonly handoffs?: ReadonlyArray<ReturnType<typeof summary>>;
    readonly noHandoffPlugin?: boolean;
    readonly records?: ReadonlyArray<Record<string, unknown>>;
  } = {},
): PeerHubStatus {
  return {
    email: "slavo@acme.test",
    environmentId: HERE,
    workspaces: [
      {
        slug: "acme",
        projects: [
          {
            project: {
              id: "orders",
              name: "Orders",
              members: [
                { email: "slavo@acme.test", name: "Slavo" },
                { email: "ana@acme.test", name: "Ana" },
              ],
            },
            work: { areas: ["Orders"], tasks: [], threads: options.records ?? [], assignments: {} },
          },
        ],
      },
    ],
    ...(options.noHandoffPlugin === true
      ? {}
      : {
          handoff: {
            target: "none",
            projectTargets: {},
            summaries: options.handoffs ?? [],
            deliveries: [],
          },
        }),
  } as unknown as PeerHubStatus;
}

/** What Needs you says each of your chats waits for, keyed the way the page reads it. */
function needs(
  entries: ReadonlyArray<[WorkThreadNode, AgentNeed]> = [],
): ReadonlyMap<string, AgentNeed> {
  return new Map(
    entries.flatMap(([node, need]) =>
      node.open === undefined ? [] : [[openKey(node.open), need]],
    ),
  );
}

function model(
  task: WorkTaskNode,
  options: {
    readonly hub?: PeerTask;
    readonly area?: string | null;
    readonly status?: PeerHubStatus;
    readonly needs?: ReadonlyMap<string, AgentNeed>;
  } = {},
): TaskPageModel {
  const built = taskPageModel({
    tree: [projectNode(task, options.hub, options.area)],
    ids: IDS,
    needs: options.needs ?? new Map(),
    status: options.status ?? status(),
    now: NOW,
  });
  if (built === null) throw new Error("the task is not in the tree");
  return built;
}

describe("taskPageModel", () => {
  it("opens a task without a chat as Not started with Start a chat", () => {
    const built = model(taskNode([]));
    expect(built.state.label).toBe("Not started");
    expect(built.primary).toEqual({ kind: "start", label: "Start a chat" });
    expect(built.offerStart).toBe(false);
    expect(built.waits).toEqual([]);
    expect(built.chats).toEqual([]);
    expect(built.area).toBe("Orders");
    expect(built.key).toBe("ORD-7");
    expect(built.meta).toBe("Created by you on 10 Oct");
  });

  it("is null for a task the tree does not have", () => {
    expect(
      taskPageModel({
        tree: [projectNode(taskNode([]))],
        ids: { ...IDS, task: "other" },
        needs: new Map(),
        status: status(),
        now: NOW,
      }),
    ).toBeNull();
    expect(
      taskPageModel({
        tree: [projectNode(taskNode([]))],
        ids: { ...IDS, project: "other" },
        needs: new Map(),
        status: status(),
        now: NOW,
      }),
    ).toBeNull();
  });

  it("reads Waiting for review while the chat still runs, with the review as its primary action", () => {
    const working = thread({
      key: "a",
      status: "working",
      activeAt: ago(3 * MIN),
      harness: "claude",
    });
    const built = model(taskNode([working], { inReview: true, context: context() }), {
      hub: hubTask({ status: "review" }),
      status: status({ handoffs: [summary(1, 300, 2), summary(2, 120, 3)] }),
    });
    expect(built.state).toMatchObject({ kind: "review", label: "Waiting for review" });
    expect(built.tone).toBe("needs");
    expect(built.primary).toEqual({ kind: "review", label: "Review handoff #2" });
    expect(built.offerStart).toBe(true);
    expect(built.waits).toEqual([
      {
        kind: "review",
        key: "review",
        title: "Your agent handed this task off 2 h ago",
        detail:
          "Review it to mark the task done, or reopen it with a note for the agent. The task context changed after the handoff (v3 → v4).",
      },
    ]);
  });

  it("falls back to a plain Review while the Hub keeps no handoff package", () => {
    const built = model(taskNode([thread({ key: "a" })], { inReview: true }), {
      hub: hubTask({ status: "review" }),
      status: status({ noHandoffPlugin: true }),
    });
    expect(built.primary).toEqual({ kind: "review", label: "Review" });
    expect(built.waits[0]).toMatchObject({
      kind: "review",
      title: "This task waits for your review",
    });
  });

  it("opens the chat that asks, for an answer, and tells an approval from an answer", () => {
    const asking = thread({ key: "q", title: "Totals", status: "blocked", harness: "claude" });
    const answer = model(taskNode([asking]), { needs: needs([[asking, "input"]]) });
    expect(answer.state.label).toBe("Needs your answer");
    expect(answer.primary).toEqual({ kind: "chat", label: "Answer in chat", open: asking.open });
    expect(answer.waits).toEqual([
      {
        kind: "input",
        key: "input:q",
        title: "Claude has a question for you",
        detail: "In “Totals”. Open the chat to answer.",
        open: asking.open,
      },
    ]);

    const approval = model(taskNode([asking]), { needs: needs([[asking, "approval"]]) });
    expect(approval.state.label).toBe("Needs your approval");
    expect(approval.primary).toMatchObject({ kind: "chat", label: "Approve in chat" });
    expect(approval.waits[0]).toMatchObject({
      kind: "approval",
      title: "Claude needs your approval",
    });
  });

  it("lists the review first and the asking chat after it, and keeps the review as primary", () => {
    const asking = thread({ key: "q", status: "blocked", harness: "codex" });
    const built = model(taskNode([asking], { inReview: true }), {
      needs: needs([[asking, "approval"]]),
    });
    expect(built.waits.map((wait) => wait.kind)).toEqual(["review", "approval"]);
    expect(built.primary.kind).toBe("review");
  });

  it("puts a chat that needs approval before one that asks", () => {
    const asks = thread({ key: "q", status: "blocked" });
    const approves = thread({ key: "p", status: "blocked" });
    const built = model(taskNode([asks, approves]), { needs: needs([[approves, "approval"]]) });
    expect(built.waits.map((wait) => wait.kind)).toEqual(["approval", "input"]);
    expect(built.primary).toMatchObject({ kind: "chat", label: "Approve in chat" });
  });

  it("starts a chat when the chat that asks is on another computer and cannot be opened", () => {
    const away = thread({
      key: "away",
      status: "blocked",
      localEnvironment: false,
      open: undefined,
    });
    const built = model(taskNode([away]));
    expect(built.state.kind).toBe("input");
    expect(built.primary.kind).toBe("start");
    expect(built.waits[0]).toMatchObject({ kind: "input", open: undefined });
  });

  it("waits on nothing once the task is done, whatever its chats do", () => {
    const asking = thread({ key: "q", status: "blocked" });
    const built = model(taskNode([asking], { done: true }), { hub: hubTask({ status: "done" }) });
    expect(built.state.label).toBe("Done");
    expect(built.tone).toBe("delivery");
    expect(built.waits).toEqual([]);
    expect(built.primary.kind).toBe("start");
  });

  it("says a colleague's chat waits on them, and reads their address from the Hub's record", () => {
    const ana = anasChat({ status: "blocked" });
    const built = model(taskNode([ana]), {
      status: status({
        records: [
          { id: "peer:t9", email: "ana@acme.test", environment: "ana-laptop", task: "ord-7" },
        ],
      }),
    });
    expect(built.state).toMatchObject({ kind: "waiting", label: "Waiting on Ana" });
    expect(built.waits).toEqual([]);
    expect(built.chats[0]).toMatchObject({
      mine: false,
      email: "ana@acme.test",
      state: { label: "Codex · waiting on Ana", tone: "working" },
    });
  });

  it("lists the person's own chats first, each with the agent's state and where it runs", () => {
    const idle = thread({
      key: "mine",
      title: "Header layout fix",
      harness: "claude",
      activeAt: ago(2 * HOUR),
    });
    const ana = anasChat({ title: "Order notes copy" });
    const built = model(taskNode([ana, idle]));
    expect(built.chats.map((chat) => chat.title)).toEqual([
      "Header layout fix",
      "Order notes copy",
    ]);
    expect(built.chats[0]).toMatchObject({
      subtitle: "Yours · Claude · this computer · last turn 2 h ago",
      state: { label: "Claude · idle", tone: "neutral" },
      agent: "Claude",
    });
    expect(built.chats[1]).toMatchObject({
      subtitle: "Ana’s · Codex · on Ana’s computer, so only Ana can open it",
      state: { label: "Codex · working", tone: "working" },
    });
  });

  it("says a colleague's shared chat can be watched, and a quiet one is not reporting", () => {
    const shared = anasChat({
      open: { kind: "observe", workspace: "acme", environment: "ana-laptop", thread: "peer:t9" },
      observable: true,
    });
    const quiet = anasChat({ key: "ana-laptop:peer:t8", stale: true, status: "unknown" });
    const built = model(taskNode([shared, quiet]));
    expect(built.chats[0]?.subtitle).toBe(
      "Ana’s · Codex · on Ana’s computer, shared so you can watch it",
    );
    expect(built.chats[1]).toMatchObject({
      subtitle: "Ana’s · Codex · on Ana’s computer, not reporting lately",
      state: { label: "Codex · offline" },
    });
  });

  it("names the agent from the client when it knows more than the harness", () => {
    const built = taskPageModel({
      tree: [projectNode(taskNode([thread({ key: "mine", harness: undefined })]))],
      ids: IDS,
      needs: new Map(),
      status: status(),
      now: NOW,
      agentName: () => "Claude (work)",
    });
    expect(built?.chats[0]?.agent).toBe("Claude (work)");
    expect(built?.chats[0]?.state.label).toBe("Claude (work) · idle");
  });

  it("says who is on the task: the person first, the colleagues, then who created it", () => {
    const built = model(taskNode([anasChat(), thread({ key: "mine" })]));
    expect(built.people).toEqual([
      { name: "Slavo", mine: true },
      { name: "Ana", mine: false },
    ]);
    expect(built.meta).toBe("You and Ana · created by you on 10 Oct");

    const byAna = model(taskNode([thread({ key: "mine" })]), {
      hub: hubTask({ createdBy: "ana@acme.test" }),
    });
    expect(byAna.people.map((person) => person.name)).toEqual(["Slavo", "Ana"]);
    expect(byAna.meta).toBe("You · created by Ana on 10 Oct");
  });

  it("shows no area for a task in none", () => {
    expect(model(taskNode([]), { area: null }).area).toBeNull();
  });

  it("sums up the task context: its version, keeper and writer, and whether it is newer than the handoff", () => {
    const built = model(taskNode([thread({ key: "a" })], { inReview: true, context: context() }), {
      hub: hubTask({ status: "review" }),
      status: status({ handoffs: [summary(2, 120, 3)] }),
    });
    expect(built.context).toEqual({
      version: 4,
      headline: "Version 4 · kept by your agent · updated 40 min ago by Ana’s agent",
      note: "The notes every agent on this task reads. Newer than handoff #2, which read v3.",
    });
  });

  it("names the writer once when it is the keeper, and counts notes that wait for the keeper", () => {
    const report = { id: "r", person: "Ana", text: "found it", at: ago(MIN) };
    const built = model(
      taskNode([], {
        context: context({
          updatedBy: "Slavo",
          reports: [report, { ...report, id: "r2" }],
        }),
      }),
    );
    expect(built.context?.headline).toBe("Version 4 · kept by your agent · updated 40 min ago");
    expect(built.context?.note).toBe(
      "The notes every agent on this task reads. 2 new notes wait for its keeper.",
    );
  });

  it("says when nobody keeps the context and when a person brought a version back", () => {
    const built = model(
      taskNode([], { context: context({ keeper: undefined, restoredFrom: 2, updatedBy: "Ana" }) }),
    );
    expect(built.context?.headline).toBe(
      "Version 4 · nobody keeps it now · v2 brought back 40 min ago by Ana",
    );
  });

  it("names the agent that keeps the context when it is one of the person's chats", () => {
    const keeper = thread({ key: "k", harness: "claude", keepsContext: true });
    const built = model(taskNode([keeper], { context: context() }));
    expect(built.context?.headline).toBe(
      "Version 4 · kept by your Claude · updated 40 min ago by Ana’s agent",
    );
  });

  it("does not call an agent nothing names by a made-up name", () => {
    const keeper = thread({ key: "k", status: "blocked", keepsContext: true });
    const built = model(taskNode([keeper], { context: context() }));
    expect(built.context?.headline).toContain("kept by your agent");
    expect(built.waits[0]).toMatchObject({ title: "Your agent has a question for you" });
  });

  it("has no context card until an agent wrote the first version", () => {
    expect(model(taskNode([])).context).toBeUndefined();
    expect(model(taskNode([], { context: context({ version: 0 }) })).context).toBeUndefined();
  });

  it("folds the branch, runtime, handoffs, context version, pull requests and creation into details", () => {
    const mine = thread({
      key: "peer:mine",
      branch: "peer/ord-7-order-notes-header",
      source: "herdr",
      harness: "claude",
    });
    const built = taskPageModel({
      tree: [
        projectNode(
          taskNode([mine, anasChat({ branch: "peer/ord-7-copy" })], {
            inReview: true,
            context: context(),
          }),
          hubTask({ status: "review" }),
        ),
      ],
      ids: IDS,
      needs: new Map(),
      status: status({
        handoffs: [summary(1, 300, 2), summary(2, 120, 3)],
        records: [
          {
            id: "peer:t9",
            email: "ana@acme.test",
            environment: "ana-laptop",
            pullRequests: [
              { url: "https://github.com/acme/orders/pull/42", state: "open", headBranch: "x" },
            ],
          },
        ],
      }),
      now: NOW,
      clock: () => "16:20",
    });
    expect(Object.fromEntries((built?.details ?? []).map((row) => [row.label, row.value]))).toEqual(
      {
        Branch: "peer/ord-7-order-notes-header, peer/ord-7-copy",
        Runtime: "herdr · this computer, Peer · Ana’s computer",
        Handoffs: "#2 waiting for review, #1 earlier",
        "Task context": "v4 (handoff #2 read v3)",
        "Pull request": "#42 open",
        Created: "by Slavo · 10 Oct, 16:20",
      },
    );
    expect(built?.details.find((row) => row.label === "Branch")?.mono).toBe(true);
  });

  it("says none yet where nothing exists, and leaves Handoffs out without the handoff plugin", () => {
    const built = model(taskNode([]), { status: status({ noHandoffPlugin: true }) });
    expect(Object.fromEntries(built.details.map((row) => [row.label, row.value]))).toEqual({
      Branch: "None yet",
      Runtime: "No chat yet",
      "Task context": "None yet",
      "Pull request": "None yet",
      Created: "by Slavo · 10 Oct, 16:20",
    });
    expect(model(taskNode([])).details.find((row) => row.label === "Handoffs")?.value).toBe(
      "None yet",
    );
  });

  it("lists earlier handoffs once the task is out of review", () => {
    const built = model(taskNode([]), {
      status: status({ handoffs: [summary(1, 300, 2), summary(2, 120, 3)] }),
    });
    expect(built.details.find((row) => row.label === "Handoffs")?.value).toBe("Earlier: #2, #1");
  });
});

describe("chatState", () => {
  const base = { agent: "Claude", need: undefined, now: NOW };

  it("says what the agent does, always with its name", () => {
    expect(
      chatState(thread({ key: "a", status: "working", activeAt: ago(3 * MIN) }), base),
    ).toEqual({ label: "Claude · working 3 min", tone: "working" });
    expect(chatState(thread({ key: "a", status: "working" }), base).label).toBe("Claude · working");
    expect(chatState(thread({ key: "a", status: "idle", activeAt: ago(2 * HOUR) }), base)).toEqual({
      label: "Claude · idle",
      tone: "neutral",
    });
    expect(chatState(thread({ key: "a", status: "idle" }), base).label).toBe("Claude · idle");
  });

  it("tells a question from an approval, and a finished turn", () => {
    const waiting = thread({ key: "a", status: "blocked" });
    expect(chatState(waiting, base)).toEqual({ label: "Claude · asks you", tone: "needs" });
    expect(chatState(waiting, { ...base, need: "approval" }).label).toBe("Claude · needs approval");
    expect(chatState(thread({ key: "a", status: "done" }), base)).toEqual({
      label: "Claude · turn finished",
      tone: "delivery",
    });
    expect(chatState(thread({ key: "a", status: "idle" }), { ...base, need: "review" }).label).toBe(
      "Claude · turn finished",
    );
  });

  it("is offline for a chat nobody reports", () => {
    expect(chatState(thread({ key: "a", stale: true, status: "working" }), base).label).toBe(
      "Claude · offline",
    );
    expect(chatState(thread({ key: "a", status: "unknown" }), base).label).toBe("Claude · offline");
  });
});

describe("taskMeta", () => {
  it("writes who is on the task and who created it", () => {
    const me = { name: "Slavo", mine: true };
    const ana = { name: "Ana", mine: false };
    const eva = { name: "Eva", mine: false };
    const pri = { name: "Pri", mine: false };
    expect(taskMeta({ onChats: [me], creator: me, createdAt: CREATED, now: NOW })).toBe(
      "You · created by you on 10 Oct",
    );
    expect(taskMeta({ onChats: [me, ana, eva], creator: ana, createdAt: CREATED, now: NOW })).toBe(
      "You, Ana and Eva · created by Ana on 10 Oct",
    );
    expect(
      taskMeta({ onChats: [me, ana, eva, pri], creator: me, createdAt: CREATED, now: NOW }),
    ).toBe("You, Ana and 2 more · created by you on 10 Oct");
    expect(taskMeta({ onChats: [], creator: ana, createdAt: undefined, now: NOW })).toBe(
      "Created by Ana",
    );
    expect(
      taskMeta({ onChats: [me, ana], creator: undefined, createdAt: undefined, now: NOW }),
    ).toBe("You and Ana");
  });
});

describe("taskStateLook", () => {
  it("colours the states that wait on the person amber and the ones that wait on others hollow", () => {
    expect(taskStateLook("review")).toEqual({ tone: "needs", hollow: false });
    expect(taskStateLook("approval").tone).toBe("needs");
    expect(taskStateLook("input").tone).toBe("needs");
    expect(taskStateLook("working")).toEqual({ tone: "working", hollow: false });
    expect(taskStateLook("waiting")).toEqual({ tone: "working", hollow: true });
    expect(taskStateLook("paused")).toEqual({ tone: "neutral", hollow: false });
    expect(taskStateLook("new")).toEqual({ tone: "neutral", hollow: true });
    expect(taskStateLook("done").tone).toBe("delivery");
  });
});
