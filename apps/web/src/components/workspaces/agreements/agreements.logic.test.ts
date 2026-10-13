import {
  PeerHubError,
  type PeerAgreement,
  type PeerAgreementsStatus,
  type PeerHubStatus,
  type PeerTask,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import type { TeamSlotInput, TeamTaskSlotInput } from "../slots.types";
import type { WorkProjectNode, WorkTaskNode, WorkThreadNode } from "../workTree.logic";
import {
  agreementFact,
  agreementFailure,
  agreementRows,
  agreementSignals,
  dueCards,
  dueForMeCount,
  dueForMeGroups,
  hasLiveAgent,
  type DueGroup,
  type People,
} from "./agreements.logic";

const NOW = Date.parse("2026-10-13T14:00:00Z");
const DAY = 86_400_000;
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const hubTask = (id: string, key: string | undefined, title: string): PeerTask => ({
  id,
  ...(key === undefined ? {} : { key }),
  title,
  status: "open",
  createdBy: "ana@acme.test",
  createdAt: "2026-10-01T09:00:00Z",
  updatedAt: "2026-10-01T09:00:00Z",
});
const TASKS = [
  hubTask("krk-1", "KRK-1", "Round prices"),
  hubTask("krk-2", "KRK-2", "Loyalty points"),
  hubTask("menu", undefined, "Menu photos"),
];

const NAMES: Readonly<Record<string, string>> = { "ana@acme.test": "Ana", "bob@acme.test": "Bob" };
const as = (me: string | null): People => ({
  me,
  name: (email) => NAMES[email] ?? email,
});
const ANA = as("ana@acme.test");
const BOB = as("bob@acme.test");
/** Someone else on the project, who finds both of them named. */
const EVA = as("eva@acme.test");

/** An agreement between KRK-1 (Ana's agent) and KRK-2 (Bob's, who settled it), open unless said. */
const agreement = (id: string, over: Partial<PeerAgreement> = {}): PeerAgreement => ({
  id,
  project: "lab",
  tasks: ["krk-1", "krk-2"],
  words: "Loyalty keeps euros; src/loyalty.js divides by 100 once KRK-1 lands",
  by: { email: "bob@acme.test", task: "krk-2" },
  settledAt: hoursAgo(2),
  sides: [
    { session: "claude:abc", environment: "env-a", email: "ana@acme.test", task: "krk-1" },
    { session: "codex:def", environment: "env-b", email: "bob@acme.test", task: "krk-2" },
  ],
  state: "open",
  landed: [],
  ...over,
});
/** KRK-1 landed, so it waits on KRK-2. */
const due = (id: string, over: Partial<PeerAgreement> = {}) =>
  agreement(id, { state: "due", dueFor: "krk-2", landed: ["krk-1"], ...over });
const closed = (id: string, why: string, by?: string, over: Partial<PeerAgreement> = {}) =>
  agreement(id, {
    state: "closed",
    closed: { at: minutesAgo(40), ...(by === undefined ? {} : { by }), why },
    ...over,
  });
const view = (...agreements: ReadonlyArray<PeerAgreement>) => ({ agreements });

const statusOf = (
  workspaces: PeerAgreementsStatus["workspaces"],
): Pick<PeerHubStatus, "agreements"> => ({
  agreements: { enabled: true, forcedOff: false, hubSupport: "supported", workspaces },
});
const row = (
  workspace: string,
  over: Partial<PeerAgreementsStatus["workspaces"][number]> = {},
): PeerAgreementsStatus["workspaces"][number] => ({ workspace, open: 0, dueForMe: [], ...over });

// ---- Needs you ---------------------------------------------------------------------------------------

describe("what waits on the person in Needs you", () => {
  const status = statusOf([
    row("acme", {
      open: 4,
      dueForMe: [
        { project: "lab", id: "a1" },
        { project: "lab", id: "a2" },
        { project: "shop", id: "s1" },
      ],
    }),
    row("other", { dueForMe: [{ project: "app", id: "b1" }] }),
    row("empty"),
  ]);

  it("counts what the status field says waits, across workspaces", () => {
    expect(dueForMeCount(status)).toBe(4);
  });

  it("groups it by project, in the order the status names it", () => {
    expect(dueForMeGroups(status)).toEqual([
      { workspace: "acme", project: "lab", ids: ["a1", "a2"] },
      { workspace: "acme", project: "shop", ids: ["s1"] },
      { workspace: "other", project: "app", ids: ["b1"] },
    ]);
  });

  it("lists an agreement once, and nothing before the field arrives", () => {
    const twice = statusOf([
      row("acme", {
        dueForMe: [
          { project: "lab", id: "a1" },
          { project: "lab", id: "a1" },
        ],
      }),
    ]);
    expect(dueForMeGroups(twice)).toEqual([{ workspace: "acme", project: "lab", ids: ["a1"] }]);
    expect(dueForMeCount(twice)).toBe(1);
    expect(dueForMeCount({})).toBe(0);
    expect(dueForMeGroups({})).toEqual([]);
  });
});

describe("the cards in Needs you", () => {
  const group: DueGroup = {
    workspace: "acme",
    project: "lab",
    ids: ["a1", "a2", "a3", "a4", "a5"],
  };
  const cards = (
    read: ReturnType<typeof view> | undefined,
    people: People = BOB,
    tasks: ReadonlyArray<PeerTask> = TASKS,
  ) => dueCards({ group, view: read, tasks, people, now: NOW });

  it("says the task, the one that landed, who settled it and when, and the words", () => {
    const [card] = cards(view(due("a1")));
    expect(card).toEqual({
      key: "acme/lab/a1",
      workspace: "acme",
      project: "lab",
      id: "a1",
      task: "krk-2",
      state: "Agreement due — KRK-1 landed",
      title: "KRK-2 · Loyalty points",
      settled: "Settled 2 h ago by your agent on KRK-2",
      words: "Loyalty keeps euros; src/loyalty.js divides by 100 once KRK-1 lands",
    });
  });

  it("names whose agent settled it for the person who did not", () => {
    expect(cards(view(due("a1")), ANA)[0]?.settled).toBe("Settled 2 h ago by Bob’s agent on KRK-2");
  });

  it("hands the words over as they were written", () => {
    const words = "  <b>divide</b> by 100\n& keep `euros` — “once”  ";
    expect(cards(view(due("a1", { words })))[0]?.words).toBe(words);
  });

  it("has a card for each due agreement of the group, newest settled first", () => {
    const read = view(
      due("a1", { settledAt: hoursAgo(30) }),
      due("a2", { settledAt: hoursAgo(1) }),
      due("a3", { settledAt: hoursAgo(5) }),
    );
    expect(cards(read).map((card) => card.id)).toEqual(["a2", "a3", "a1"]);
  });

  it("has none for an agreement the Hub's view no longer holds as due", () => {
    const read = view(
      due("a1"),
      closed("a2", "handled", "bob@acme.test", { dueFor: "krk-2" }),
      agreement("a3"),
      due("a4", { project: "other" }),
      due("not-asked-for"),
      due("a5", { dueFor: undefined }),
    );
    expect(cards(read).map((card) => card.id)).toEqual(["a1"]);
  });

  it("has none before the view is read, and none for what the status does not name", () => {
    expect(cards(undefined)).toEqual([]);
    expect(cards(view())).toEqual([]);
  });

  it("falls back to the id of a task the project does not list any more", () => {
    const [card] = cards(view(due("a1")), BOB, [hubTask("krk-2", "KRK-2", "Loyalty points")]);
    expect(card?.state).toBe("Agreement due — krk-1 landed");
    expect(card?.title).toBe("KRK-2 · Loyalty points");
    const [bare] = cards(view(due("a1")), BOB, []);
    expect(bare?.title).toBe("krk-2");
    expect(bare?.settled).toBe("Settled 2 h ago by your agent on krk-2");
  });

  it("names a task that has no key by its title", () => {
    const [card] = cards(view(due("a1", { tasks: ["menu", "krk-2"], landed: ["menu"] })));
    expect(card?.state).toBe("Agreement due — Menu photos landed");
  });
});

// ---- a task's page -----------------------------------------------------------------------------------

describe("a task's agreements as its page lists them", () => {
  const rows = (
    read: ReturnType<typeof view> | undefined,
    task = "krk-2",
    people: People = ANA,
    tasks: ReadonlyArray<PeerTask> = TASKS,
  ) => agreementRows({ view: read, project: "lab", task, tasks, people, now: NOW });

  it("lists those not closed first, then the closed ones, newest settled first", () => {
    const read = view(
      closed("closed-old", "handled", "ana@acme.test", { settledAt: hoursAgo(50) }),
      agreement("open-old", { settledAt: hoursAgo(20) }),
      closed("closed-new", "replaced", undefined, { settledAt: hoursAgo(3) }),
      due("due-new", { settledAt: hoursAgo(4) }),
      agreement("other-pair", { tasks: ["krk-1", "menu"] }),
      agreement("other-project", { project: "shop" }),
    );
    expect(rows(read).map((entry) => entry.id)).toEqual([
      "due-new",
      "open-old",
      "closed-new",
      "closed-old",
    ]);
  });

  it("is empty for a task without agreements, and before a view is read", () => {
    expect(rows(view(agreement("a1")), "menu")).toEqual([]);
    expect(rows(undefined)).toEqual([]);
  });

  it("names the other task from either side, and says whether its page can open", () => {
    const [seen] = rows(view(agreement("a1")), "krk-2");
    expect(seen?.other).toEqual({ id: "krk-1", label: "KRK-1 · Round prices", known: true });
    expect(rows(view(agreement("a1")), "krk-1")[0]?.other).toEqual({
      id: "krk-2",
      label: "KRK-2 · Loyalty points",
      known: true,
    });
    const gone = rows(view(agreement("a1")), "krk-2", ANA, [TASKS[1]!])[0];
    expect(gone?.other).toEqual({ id: "krk-1", label: "krk-1", known: false });
  });

  it("says who settled it and when, as the person looking would put it", () => {
    expect(rows(view(agreement("a1")), "krk-1", ANA)[0]?.settled).toBe(
      "Settled 2 h ago by Bob’s agent on KRK-2",
    );
    expect(rows(view(agreement("a1")), "krk-1", BOB)[0]?.settled).toBe(
      "Settled 2 h ago by your agent on KRK-2",
    );
    const unreadable = agreement("a1", { settledAt: "soon" });
    expect(rows(view(unreadable))[0]?.settled).toBe("Settled by Bob’s agent on KRK-2");
  });

  it("says the state: due names the task that landed, a closing says how and when", () => {
    const read = view(
      agreement("open"),
      due("due"),
      closed("handled", "handled", "ana@acme.test"),
      closed("not-needed", "not-needed", "bob@acme.test"),
      closed("replaced", "replaced"),
      closed("landed", "landed", undefined, { landed: ["krk-1", "krk-2"] }),
    );
    const states = Object.fromEntries(
      rows(read, "krk-2", EVA).map((entry) => [entry.id, entry.state]),
    );
    expect(states).toEqual({
      open: "Open",
      due: "Due — KRK-1 landed",
      handled: "Closed · handled by Ana · 40 min ago",
      "not-needed": "Closed · not needed by Bob · 40 min ago",
      replaced: "Replaced · 40 min ago",
      landed: "Both landed · 40 min ago",
    });
    expect(rows(view(closed("handled", "handled", "ana@acme.test")), "krk-2", ANA)[0]?.state).toBe(
      "Closed · handled by you · 40 min ago",
    );
  });

  it("colors only what waits on a person", () => {
    const read = view(agreement("open"), due("due"), closed("closed", "handled", "ana@acme.test"));
    const tones = Object.fromEntries(rows(read).map((entry) => [entry.id, entry.tone]));
    expect(tones).toEqual({ open: "neutral", due: "needs", closed: "neutral" });
  });

  it("offers Close to an open or due agreement, and Reopen to one a person closed", () => {
    const read = view(
      agreement("open"),
      due("due"),
      closed("by-person", "not-needed", "ana@acme.test"),
      closed("by-hub", "expired"),
      closed("landed", "handled", "ana@acme.test", { landed: ["krk-1"] }),
    );
    const offers = Object.fromEntries(
      rows(read).map((entry) => [entry.id, [entry.canClose, entry.canReopen]]),
    );
    expect(offers).toEqual({
      open: [true, false],
      due: [true, false],
      "by-person": [false, true],
      "by-hub": [false, false],
      landed: [false, false],
    });
  });

  it("stops offering Reopen 30 days after the settle", () => {
    const person = (settled: number) =>
      closed("a1", "handled", "ana@acme.test", {
        settledAt: new Date(NOW - settled).toISOString(),
      });
    expect(rows(view(person(29 * DAY)))[0]?.canReopen).toBe(true);
    expect(rows(view(person(31 * DAY)))[0]?.canReopen).toBe(false);
  });

  it("offers nothing for a state a newer Hub names", () => {
    const [paused] = rows(view(agreement("a1", { state: "paused" })));
    expect(paused).toMatchObject({
      state: "Unknown state",
      tone: "neutral",
      canClose: false,
      canReopen: false,
    });
  });
});

describe("why a close or a reopen did not happen", () => {
  const refused = (error: unknown) => AsyncResult.failure(Cause.fail(error));

  it("says nothing when it worked, or the person interrupted it", () => {
    expect(agreementFailure(AsyncResult.success({}))).toBeNull();
    expect(agreementFailure(AsyncResult.failure(Cause.interrupt()))).toBeNull();
  });

  it("says a refusal of the agreement's state the same way for every reason, and asks to read again", () => {
    const state = new PeerHubError({ code: "agreement_state", detail: "agreement is closed" });
    expect(agreementFailure(refused(state))).toEqual({
      message: "This agreement changed since you opened it, so nothing was done.",
      stale: true,
    });
  });

  it("passes on what the Hub, or the network, said otherwise", () => {
    const hub = new PeerHubError({ code: "forbidden", detail: "only project members may do this" });
    expect(agreementFailure(refused(hub))).toEqual({
      message: "only project members may do this",
      stale: false,
    });
    expect(agreementFailure(refused(new Error("Hub unreachable")))).toEqual({
      message: "Hub unreachable",
      stale: false,
    });
    expect(agreementFailure(refused("boom"))).toEqual({ message: "boom", stale: false });
  });
});

// ---- the Team page -----------------------------------------------------------------------------------

const thread = (over: Partial<WorkThreadNode> = {}): WorkThreadNode => ({
  key: "chat",
  title: "chat",
  person: "Ana",
  email: "ana@acme.test",
  mine: false,
  status: "working",
  harness: undefined,
  branch: undefined,
  source: "peer",
  stale: false,
  open: undefined,
  placeable: false,
  concerns: undefined,
  observable: false,
  agent: undefined,
  activeAt: undefined,
  keepsContext: false,
  ...over,
});
const taskNode = (task: PeerTask, threads: ReadonlyArray<WorkThreadNode> = []): WorkTaskNode => ({
  id: task.id,
  key: task.key,
  title: task.title,
  done: false,
  status: "idle",
  threads,
  removable: true,
  context: undefined,
});
const projectOf = (threads: Readonly<Record<string, ReadonlyArray<WorkThreadNode>>> = {}) =>
  ({
    workspace: "acme",
    workspaceName: "Acme",
    projectId: "lab",
    name: "Lab",
    areas: [{ name: null, tasks: TASKS.map((task) => taskNode(task, threads[task.id])) }],
    unsorted: [],
    context: undefined,
    candidates: 0,
    tasks: TASKS,
    ownership: undefined,
  }) satisfies WorkProjectNode;

describe("whether an agent is live on a task", () => {
  const live = (...threads: ReadonlyArray<WorkThreadNode>) =>
    hasLiveAgent(projectOf({ "krk-2": threads }), "krk-2");

  it("counts a chat at work, waiting or idle, and one whose state nobody can tell", () => {
    expect(live(thread({ status: "working" }))).toBe(true);
    expect(live(thread({ status: "blocked" }))).toBe(true);
    expect(live(thread({ status: "idle" }))).toBe(true);
    expect(live(thread({ status: "unknown" }))).toBe(true);
  });

  it("does not count a chat nobody reports, one that is delivered, or one that is settled", () => {
    expect(live(thread({ stale: true, status: "unknown" }))).toBe(false);
    expect(live(thread({ delivery: "merged" }))).toBe(false);
    expect(live(thread({ delivery: "closed" }))).toBe(false);
    expect(live(thread({ status: "done" }))).toBe(false);
    expect(live()).toBe(false);
  });

  it("looks only at the task's own chats", () => {
    const project = projectOf({ "krk-1": [thread()] });
    expect(hasLiveAgent(project, "krk-1")).toBe(true);
    expect(hasLiveAgent(project, "krk-2")).toBe(false);
    expect(hasLiveAgent(project, "elsewhere")).toBe(false);
  });

  it("counts a chat among others that are not", () => {
    expect(live(thread({ stale: true }), thread({ delivery: "merged" }), thread())).toBe(true);
  });
});

describe("the fact on a task's row on the Team page", () => {
  const fact = (
    workspaces: PeerAgreementsStatus["workspaces"] | undefined,
    task = "krk-2",
    project: WorkProjectNode = projectOf(),
  ) => {
    const found = TASKS.find((candidate) => candidate.id === task)!;
    const status =
      workspaces === undefined
        ? ({} as PeerHubStatus)
        : ({ ...statusOf(workspaces) } as PeerHubStatus);
    return agreementFact({
      status,
      project,
      now: NOW,
      task: { id: found.id, key: found.key, title: found.title },
    } satisfies TeamTaskSlotInput);
  };
  const counts = (task: string, open: number, dueCount: number, project = "lab") => ({
    project,
    task,
    open,
    due: dueCount,
  });
  const waiting = { project: "lab", id: "a1", dueFor: "krk-2", landed: "krk-1" };

  it("says an agreement is due and which task landed, in the tone of what waits on a person", () => {
    const found = fact([row("acme", { tasks: [counts("krk-2", 1, 1)], due: [waiting] })]);
    expect(found).toMatchObject({
      id: "agreements",
      text: "Agreement due — KRK-1 landed",
      tone: "needs",
    });
  });

  it("says the same quietly while an agent works on the task, which hears it at its next step", () => {
    const live = projectOf({ "krk-2": [thread({ status: "idle" })] });
    const found = fact(
      [row("acme", { tasks: [counts("krk-2", 1, 1)], due: [waiting] })],
      "krk-2",
      live,
    );
    expect(found).toMatchObject({ text: "Agreement due — KRK-1 landed", tone: "neutral" });
    // An agent on the task that landed does not hear what is due on the other.
    const elsewhere = projectOf({ "krk-1": [thread()] });
    const waits = fact(
      [row("acme", { tasks: [counts("krk-2", 1, 1)], due: [waiting] })],
      "krk-2",
      elsewhere,
    );
    expect(waits?.tone).toBe("needs");
  });

  it("counts several due, and says only that one is due where the due list is missing", () => {
    const two = fact([
      row("acme", {
        tasks: [counts("krk-2", 2, 2)],
        due: [waiting, { ...waiting, id: "a2", landed: "menu" }],
      }),
    ]);
    expect(two?.text).toBe("2 agreements due");
    const bare = fact([row("acme", { tasks: [counts("krk-2", 1, 1)] })]);
    expect(bare).toMatchObject({ text: "Agreement due", tone: "needs" });
  });

  it("says an agreement is open, quietly", () => {
    expect(fact([row("acme", { tasks: [counts("krk-2", 1, 0)] })])).toMatchObject({
      text: "Agreement open",
      tone: "neutral",
    });
    expect(fact([row("acme", { tasks: [counts("krk-2", 3, 0)] })])?.text).toBe("3 agreements open");
  });

  it("names the other task of the task that landed, where the due list says it", () => {
    const landed = fact([row("acme", { tasks: [counts("krk-1", 1, 0)], due: [waiting] })], "krk-1");
    expect(landed).toMatchObject({ text: "Agreement with KRK-2 — due there", tone: "neutral" });
    // Another agreement of the task that the status says nothing about: no one name stands for both.
    const more = fact([row("acme", { tasks: [counts("krk-1", 2, 0)], due: [waiting] })], "krk-1");
    expect(more?.text).toBe("2 agreements open");
  });

  it("says nothing for a task without an agreement, or before the status says anything", () => {
    expect(fact([row("acme", { tasks: [counts("krk-2", 0, 0)] })])).toBeUndefined();
    expect(fact([row("acme", { tasks: [counts("krk-1", 1, 0)] })])).toBeUndefined();
    expect(fact([row("acme", { tasks: [counts("krk-2", 1, 0, "shop")] })])).toBeUndefined();
    expect(fact([row("elsewhere", { tasks: [counts("krk-2", 1, 0)] })])).toBeUndefined();
    expect(fact([row("acme")])).toBeUndefined();
    expect(fact(undefined)).toBeUndefined();
  });

  it("opens the task's context page, where its agreements are listed", () => {
    const navigate = vi.fn();
    fact([row("acme", { tasks: [counts("krk-2", 1, 0)] })])?.open?.(navigate as never);
    expect(navigate).toHaveBeenCalledWith({
      to: "/context/$workspace/$project/$scope",
      params: { workspace: "acme", project: "lab", scope: "task:krk-2" },
    });
  });
});

describe("the signals on the Team page", () => {
  const signals = (
    workspaces: PeerAgreementsStatus["workspaces"] | undefined,
    project: WorkProjectNode = projectOf(),
  ) =>
    agreementSignals({
      status: (workspaces === undefined ? {} : statusOf(workspaces)) as PeerHubStatus,
      project,
      now: NOW,
    } satisfies TeamSlotInput);
  const entry = (
    id: string,
    over: Partial<{ project: string; dueFor: string; landed: string }> = {},
  ) => ({
    project: "lab",
    id,
    dueFor: "krk-2",
    landed: "krk-1",
    ...over,
  });

  it("raises one for an agreement due on a task nobody works on, and says who to ask", () => {
    expect(signals([row("acme", { due: [entry("a1")] })])).toEqual([
      {
        id: "due:a1",
        what: "KRK-2 has an agreement due",
        detail: "KRK-1 landed; nobody works on KRK-2",
        action: { label: "Open task", open: expect.any(Function) },
      },
    ]);
  });

  it("opens the task's page from its action", () => {
    const navigate = vi.fn();
    signals([row("acme", { due: [entry("a1")] })])[0]?.action?.open(navigate as never);
    expect(navigate).toHaveBeenCalledWith({
      to: "/task/$workspace/$project/$task",
      params: { workspace: "acme", project: "lab", task: "krk-2" },
    });
  });

  it("raises none while an agent is live on the task: it hears the agreement at its next step", () => {
    const project = projectOf({ "krk-2": [thread({ status: "idle" })] });
    expect(signals([row("acme", { due: [entry("a1")] })], project)).toEqual([]);
  });

  it("raises one where the task's chats are left behind, delivered or settled", () => {
    const project = projectOf({
      "krk-2": [
        thread({ stale: true }),
        thread({ delivery: "merged" }),
        thread({ status: "done" }),
      ],
    });
    expect(signals([row("acme", { due: [entry("a1")] })], project)).toHaveLength(1);
  });

  it("judges each due agreement by its own task, and keeps the status field's order", () => {
    const project = projectOf({ "krk-1": [thread()] });
    const found = signals(
      [
        row("acme", {
          due: [
            entry("a1", { dueFor: "krk-1", landed: "krk-2" }),
            entry("a2"),
            entry("a3", { dueFor: "menu", landed: "krk-2" }),
          ],
        }),
      ],
      project,
    );
    expect(found.map((signal) => signal.id)).toEqual(["due:a2", "due:a3"]);
    expect(found[1]?.what).toBe("Menu photos has an agreement due");
  });

  it("leaves out another project's agreements, a task the project does not list, and no field", () => {
    expect(
      signals([
        row("acme", {
          due: [entry("a1", { project: "shop" }), entry("a2", { dueFor: "removed" })],
        }),
      ]),
    ).toEqual([]);
    expect(signals([row("elsewhere", { due: [entry("a1")] })])).toEqual([]);
    expect(signals([row("acme")])).toEqual([]);
    expect(signals(undefined)).toEqual([]);
  });
});
