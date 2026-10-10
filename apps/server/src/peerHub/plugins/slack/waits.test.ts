import { describe, expect, it } from "@effect/vitest";
import {
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  slackWaits,
  turnEndedAt,
  type SlackLocalAgent,
  type SlackPlace,
  type SlackQuestion,
  type SlackRequest,
  type SlackShell,
  type SlackWait,
  type SlackWaitAgent,
  type SlackWaitInput,
  type SlackWaitThread,
} from "./waits.ts";

const at = (iso: string) => DateTime.makeUnsafe(iso);
const characters = (...codes: number[]) => String.fromCodePoint(...codes);
const token = `ghp_${"aZ09".repeat(9)}`;

const place: SlackPlace = { workspace: "acme", project: "webshop" };
const elsewhere: SlackPlace = { workspace: "other", project: "x" };
const task = { id: "task-7", key: "APP-7", title: "Ship checkout" };

/** A thread whose run is working: nothing to ask of anyone yet. */
const shell = (over: Partial<SlackShell> = {}): SlackShell => ({
  id: ThreadId.make("thread-1"),
  projectId: ProjectId.make("t3-project"),
  title: "Fix the login",
  providerInstanceId: ProviderInstanceId.make("claudeAgent"),
  lineage: {
    parentThreadId: null,
    relationshipToParent: null,
    rootThreadId: ThreadId.make("thread-1"),
  },
  archivedAt: null,
  status: "running",
  activeRunId: RunId.make("run-1"),
  activityRunStatus: "running",
  latestRunId: RunId.make("run-1"),
  latestRunCompletedAt: null,
  latestUserMessageAt: at("2026-10-10T11:50:00Z"),
  pendingRuntimeRequest: null,
  latestVisibleMessage: null,
  pendingBackgroundTasks: [],
  ...over,
});

/** A thread whose run waits on request `req-1`, created at 11:58. */
const asking = (kind: "command" | "user_input" = "command", over: Partial<SlackShell> = {}) =>
  shell({
    status: "waiting",
    activityRunStatus: "waiting",
    pendingRuntimeRequest: {
      id: RuntimeRequestId.make("req-1"),
      kind,
      createdAt: at("2026-10-10T11:58:00Z"),
    },
    ...over,
  });

/** A thread whose run completed at 12:00, ten minutes after the person's last message. */
const finished = (over: Partial<SlackShell> = {}) =>
  shell({
    status: "completed",
    activeRunId: null,
    activityRunStatus: null,
    latestRunCompletedAt: at("2026-10-10T12:00:00Z"),
    ...over,
  });

const approval = (prompt?: string): SlackRequest => ({
  kind: "approval",
  requestId: "req-1",
  ...(prompt === undefined ? {} : { prompt }),
});
const question = (text: string, ...labels: string[]): SlackQuestion => ({
  id: text,
  question: text,
  options: labels.map((label) => ({ label })),
});
const asks = (...questions: SlackQuestion[]): SlackRequest => ({
  kind: "user_input",
  requestId: "req-1",
  questions,
});

const thread = (over: Partial<SlackWaitThread> = {}): SlackWaitThread => ({
  shell: shell(),
  place,
  ...over,
});
/** A thread that finished, and what its agent said last. */
const done = (over: Partial<SlackWaitThread> = {}) =>
  thread({
    shell: finished(),
    latestMessage: { role: "assistant", text: "Added it. Tests next?" },
    ...over,
  });
/** A thread that asks for an approval. */
const approving = (prompt = "Go?", over: Partial<SlackWaitThread> = {}) =>
  thread({ shell: asking(), request: approval(prompt), ...over });

const herdr = (over: Partial<SlackLocalAgent> = {}): SlackLocalAgent => ({
  id: "herdr:claude:sess-1",
  paneId: "pane-1",
  agent: "claude",
  title: "Refactor billing",
  status: "done",
  session: "sess-1",
  turn: 4,
  ...over,
});
const agent = (over: Partial<SlackWaitAgent> = {}): SlackWaitAgent => ({
  agent: herdr(),
  place,
  ...over,
});

const input = (over: Partial<SlackWaitInput> = {}): SlackWaitInput => ({
  threads: [],
  agents: [],
  connectedWorkspaces: new Set(["acme"]),
  computer: "Ana's MacBook",
  now: "2026-10-10T12:05:00.000Z",
  ...over,
});
const waitsOf = (over: Partial<SlackWaitInput>) => slackWaits(input(over));
const keys = (over: Partial<SlackWaitInput>) => waitsOf(over).map((wait) => wait.waitKey);
/** The only wait of an input. */
const only = (over: Partial<SlackWaitInput>): SlackWait => {
  const waits = waitsOf(over);
  expect(waits).toHaveLength(1);
  return waits[0]!;
};

const peer = {
  key: "peer:thread-1",
  title: "Fix the login",
  agent: "Claude",
  computer: "Ana's MacBook",
};
const terminal = {
  key: "herdr:claude:sess-1",
  title: "Refactor billing",
  agent: "Claude Code",
  computer: "Ana's MacBook",
};

describe("a Peer thread that waits for an approval", () => {
  it("is an approval with the request's text and the two decisions", () => {
    expect(only({ threads: [approving("Run npm test?")] })).toStrictEqual({
      waitKey: "peer:thread-1:req:req-1",
      subject: peer,
      kind: "approval",
      workspace: "acme",
      project: "webshop",
      title: "Fix the login",
      text: "Run npm test?",
      decisions: ["accept", "decline"],
      since: "2026-10-10T11:58:00.000Z",
    });
  });

  it("says what is asked when the request has no prompt", () => {
    const wait = only({ threads: [thread({ shell: asking(), request: approval() })] });
    expect(wait.text).toBe("Approval needed: command");
    expect(wait.decisions).toEqual(["accept", "decline"]);
  });

  it("shows the command without a credential in it, cut to the bound", () => {
    const wait = only({
      threads: [approving(`curl -H "Authorization: token ${token}" ${"x".repeat(5_000)}`)],
    });
    expect(wait.text).toHaveLength(2_800);
    expect(wait.text).toMatch(/^curl -H "Authorization: token \[redacted\]/);
    expect(wait.text).not.toContain("ghp_");
    expect(wait.text).toMatch(/… the rest is in Peer$/);
  });

  it("waits only when the request the shell names has been read", () => {
    expect(keys({ threads: [thread({ shell: asking() })] })).toEqual([]);
    const other: SlackRequest = { kind: "approval", requestId: "req-0", prompt: "Old" };
    expect(keys({ threads: [thread({ shell: asking(), request: other })] })).toEqual([]);
    // A request read for a shell that waits on nothing is no wait.
    expect(keys({ threads: [thread({ request: approval("Run it?") })] })).toEqual([]);
  });
});

describe("a Peer thread that waits for an answer", () => {
  const waiting = (request: SlackRequest) =>
    only({ threads: [thread({ shell: asking("user_input"), request })] });

  it("is a question with a button per option for one question with a choice", () => {
    expect(waiting(asks(question("Which database?", "Postgres", "MySQL", "SQLite")))).toStrictEqual(
      {
        waitKey: "peer:thread-1:req:req-1",
        subject: peer,
        kind: "question",
        workspace: "acme",
        project: "webshop",
        title: "Fix the login",
        text: "Which database?",
        options: ["Postgres", "MySQL", "SQLite"],
        since: "2026-10-10T11:58:00.000Z",
      },
    );
    expect(waiting(asks(question("Pick", "a", "b", "c", "d", "e"))).options).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
    expect(waiting(asks(question("Pick", "only"))).options).toEqual(["only"]);
  });

  it("cuts a long label to what a button holds and never leaves a button empty", () => {
    const wait = waiting(asks(question("Pick", "x".repeat(100), "ok")));
    expect(wait.options).toEqual([`${"x".repeat(74)}…`, "ok"]);
    const invisible = waiting(asks(question("Pick", characters(0x07), "ok")));
    expect(invisible.options).toEqual(["Option 1", "ok"]);
  });

  it("is a question for Peer when Slack cannot carry it as one choice", () => {
    const many = waiting(asks(question("Pick one", "a", "b", "c", "d", "e", "f")));
    expect(many.options).toBeUndefined();
    expect(many.text).toBe("Pick one\n\nAnswer in Peer");

    const several = waiting(asks(question("Which database?", "a", "b"), question("Which region?")));
    expect(several.kind).toBe("question");
    expect(several.options).toBeUndefined();
    expect(several.text).toBe("Which database?\nWhich region?\n\nAnswer in Peer");

    const any: SlackQuestion = { ...question("Pick any", "a", "b"), multiSelect: true };
    expect(waiting(asks(any)).options).toBeUndefined();
    expect(waiting(asks(any)).text).toBe("Pick any\n\nAnswer in Peer");

    const free = waiting(asks(question("What should the branch be called?")));
    expect(free.options).toBeUndefined();
    expect(free.text).toBe("What should the branch be called?\n\nAnswer in Peer");

    const single: SlackQuestion = { ...question("Pick", "a", "b"), multiSelect: false };
    expect(waiting(asks(single)).options).toEqual(["a", "b"]);
  });

  it("keeps where the answer goes when the questions are long", () => {
    const wait = waiting(asks(question("q".repeat(5_000)), question("two")));
    expect(wait.text).toHaveLength(2_800);
    expect(wait.text?.endsWith("… the rest is in Peer\n\nAnswer in Peer")).toBe(true);
  });
});

describe("a Peer thread that finished its turn", () => {
  it("waits for the person, with what the agent said last", () => {
    expect(only({ threads: [done()] })).toStrictEqual({
      waitKey: "peer:thread-1:run:run-1",
      subject: peer,
      kind: "finished",
      workspace: "acme",
      project: "webshop",
      title: "Fix the login",
      text: "Added it. Tests next?",
      since: "2026-10-10T12:00:00.000Z",
    });
  });

  it("takes the message from the shell when the shell has it", () => {
    const latestVisibleMessage = {
      id: MessageId.make("message-1"),
      role: "assistant" as const,
      text: "From the shell",
      updatedAt: at("2026-10-10T12:00:00Z"),
    };
    const wait = only({ threads: [thread({ shell: finished({ latestVisibleMessage }) })] });
    expect(wait.text).toBe("From the shell");
  });

  it("is over once the person wrote after the turn ended", () => {
    const newer = finished({ latestUserMessageAt: at("2026-10-10T12:01:00Z") });
    expect(keys({ threads: [done({ shell: newer })] })).toEqual([]);
    const same = finished({ latestUserMessageAt: at("2026-10-10T12:00:00Z") });
    expect(keys({ threads: [done({ shell: same })] })).toEqual([]);
    // A thread nobody wrote in (started by a schedule) has no message to be older than.
    const unprompted = finished({ latestUserMessageAt: null });
    expect(keys({ threads: [done({ shell: unprompted })] })).toEqual(["peer:thread-1:run:run-1"]);
  });

  it("is not one while a run is active", () => {
    const active: ReadonlyArray<Partial<SlackShell>> = [
      { status: "running", activeRunId: RunId.make("run-2") },
      { status: "running" },
      { status: "queued" },
      { status: "waiting" },
      { activityRunStatus: "waiting" },
      { activeRunId: RunId.make("run-2") },
    ];
    for (const over of active) {
      expect(keys({ threads: [done({ shell: finished(over) })] }), JSON.stringify(over)).toEqual(
        [],
      );
    }
  });

  it("is the request, not the finished turn before it, when the thread waits on one", () => {
    const pending = asking("command", {
      status: "completed",
      activeRunId: null,
      activityRunStatus: null,
      latestRunCompletedAt: at("2026-10-10T12:00:00Z"),
    });
    const thread = done({ shell: pending, request: approval("Go?") });
    expect(keys({ threads: [thread] })).toEqual(["peer:thread-1:req:req-1"]);
  });

  it("is not one after a run that failed, was stopped, or never completed", () => {
    for (const status of ["failed", "interrupted", "cancelled", "rolled_back"] as const) {
      expect(keys({ threads: [done({ shell: finished({ status }) })] }), status).toEqual([]);
    }
    expect(keys({ threads: [done({ shell: finished({ latestRunCompletedAt: null }) })] })).toEqual(
      [],
    );
    expect(keys({ threads: [done({ shell: finished({ latestRunId: null }) })] })).toEqual([]);
  });

  it("is one only when the last message is the agent's", () => {
    const user = { role: "user", text: "Go on" };
    expect(keys({ threads: [done({ latestMessage: user })] })).toEqual([]);
    expect(keys({ threads: [done({ latestMessage: null })] })).toEqual([]);
    expect(keys({ threads: [done({ latestMessage: undefined })] })).toEqual([]);
  });

  it("waits out work that will wake the agent, but not a command left running", () => {
    const subagent = [{ taskId: "t1", kind: "subagent" as const }];
    const command = [{ taskId: "t2", kind: "command" as const }];
    const holding = done({ shell: finished({ pendingBackgroundTasks: subagent }) });
    expect(keys({ threads: [holding] })).toEqual([]);
    const running = done({ shell: finished({ pendingBackgroundTasks: command }) });
    expect(keys({ threads: [running] })).toEqual(["peer:thread-1:run:run-1"]);
  });

  it("has the agent's words without credentials, and no text when it said nothing", () => {
    const text = `password: hunter2 and sk-${"aZ09".repeat(8)}`;
    const said = only({ threads: [done({ latestMessage: { role: "assistant", text } })] });
    expect(said.text).toBe("password: [redacted] and [redacted]");
    const blank = { role: "assistant", text: "  \n " };
    const silent = only({ threads: [done({ latestMessage: blank })] });
    expect(silent.kind).toBe("finished");
    expect(silent).not.toHaveProperty("text");
  });
});

describe("the end of a thread's turn", () => {
  const endedAt = (over: Partial<SlackShell>) => {
    const ended = turnEndedAt(finished(over));
    return ended === undefined ? undefined : DateTime.formatIso(ended);
  };

  it("is when its last run completed, while nothing has happened since", () => {
    expect(endedAt({})).toBe("2026-10-10T12:00:00.000Z");
    expect(endedAt({ status: "idle" })).toBe("2026-10-10T12:00:00.000Z");
    expect(endedAt({ latestUserMessageAt: null })).toBe("2026-10-10T12:00:00.000Z");
    const command = [{ taskId: "t", kind: "command" as const }];
    expect(endedAt({ pendingBackgroundTasks: command })).toBe("2026-10-10T12:00:00.000Z");
  });

  it("is nothing while the thread works, waits on something or was written in since", () => {
    expect(endedAt({ latestRunCompletedAt: null })).toBeUndefined();
    expect(endedAt({ status: "running" })).toBeUndefined();
    expect(endedAt({ activeRunId: RunId.make("run-2") })).toBeUndefined();
    expect(endedAt({ activityRunStatus: "running" })).toBeUndefined();
    expect(endedAt({ latestUserMessageAt: at("2026-10-10T12:00:01Z") })).toBeUndefined();
    const subagent = [{ taskId: "t", kind: "subagent" as const }];
    expect(endedAt({ pendingBackgroundTasks: subagent })).toBeUndefined();
    const pendingRuntimeRequest = asking().pendingRuntimeRequest;
    expect(endedAt({ pendingRuntimeRequest })).toBeUndefined();
    expect(turnEndedAt(shell())).toBeUndefined();
  });
});

describe("what is left out", () => {
  it("is a thread outside a Peer workspace project, or in a workspace without Slack", () => {
    expect(keys({ threads: [approving()] })).toEqual(["peer:thread-1:req:req-1"]);
    expect(keys({ threads: [approving("Go?", { place: undefined })] })).toEqual([]);
    expect(keys({ threads: [approving("Go?", { place: elsewhere })] })).toEqual([]);
    expect(keys({ threads: [approving()], connectedWorkspaces: new Set() })).toEqual([]);
    expect(keys({ threads: [done({ place: elsewhere })] })).toEqual([]);
  });

  it("is an agent outside a Peer workspace project, or in a workspace without Slack", () => {
    expect(keys({ agents: [agent()] })).toEqual(["herdr:claude:sess-1:done:4"]);
    expect(keys({ agents: [agent({ place: undefined })] })).toEqual([]);
    expect(keys({ agents: [agent({ place: elsewhere })] })).toEqual([]);
    expect(keys({ agents: [agent()], connectedWorkspaces: new Set() })).toEqual([]);
  });

  it("is a subagent's thread and an archived one, not a fork", () => {
    const lineage = (relationshipToParent: "fork" | "subagent") => ({
      parentThreadId: ThreadId.make("parent"),
      relationshipToParent,
      rootThreadId: ThreadId.make("parent"),
    });
    const inside = (over: Partial<SlackShell>) =>
      approving("Go?", { shell: asking("command", over) });
    expect(keys({ threads: [inside({ lineage: lineage("subagent") })] })).toEqual([]);
    expect(keys({ threads: [inside({ archivedAt: at("2026-10-10T10:00:00Z") })] })).toEqual([]);
    expect(keys({ threads: [inside({ lineage: lineage("fork") })] })).toEqual([
      "peer:thread-1:req:req-1",
    ]);
    const finishedSubagent = done({ shell: finished({ lineage: lineage("subagent") }) });
    expect(keys({ threads: [finishedSubagent] })).toEqual([]);
    const finishedArchived = done({ shell: finished({ archivedAt: at("2026-10-10T10:00:00Z") }) });
    expect(keys({ threads: [finishedArchived] })).toEqual([]);
  });

  it("is a thread whose run still works", () => {
    expect(keys({ threads: [thread({ request: approval("Go?") })] })).toEqual([]);
    expect(keys({ threads: [thread()] })).toEqual([]);
  });
});

describe("what the provider of a thread is called", () => {
  const providerOf = (instance: string) =>
    only({
      threads: [
        approving("Go?", {
          shell: asking("command", { providerInstanceId: ProviderInstanceId.make(instance) }),
        }),
      ],
    }).subject.agent;

  it("is the provider's name, whatever the instance is called after it", () => {
    expect(providerOf("claudeAgent")).toBe("Claude");
    expect(providerOf("codex")).toBe("Codex");
    expect(providerOf("codex_personal")).toBe("Codex");
    expect(providerOf("claudeAgent-work")).toBe("Claude");
    expect(providerOf("cursor")).toBe("Cursor");
    expect(providerOf("opencode")).toBe("OpenCode");
  });

  it("is Agent when it is not clear", () => {
    expect(providerOf("my-own")).toBe("Agent");
    expect(providerOf("x1")).toBe("Agent");
  });
});

describe("a herdr agent", () => {
  it("that is blocked is a notice with nothing of the terminal", () => {
    const blocked = agent({
      agent: herdr({ status: "blocked" }),
      lastMessage: "Allow `rm -rf /`? (y/n)",
    });
    expect(only({ agents: [blocked] })).toStrictEqual({
      waitKey: "herdr:claude:sess-1:blocked:4",
      subject: terminal,
      kind: "blocked",
      workspace: "acme",
      project: "webshop",
      title: "Refactor billing",
      since: "2026-10-10T12:05:00.000Z",
    });
  });

  it("that is done has finished a turn, with the last thing it said if that is known", () => {
    const said = agent({ lastMessage: "Billing is split in two modules." });
    expect(only({ agents: [said] })).toStrictEqual({
      waitKey: "herdr:claude:sess-1:done:4",
      subject: terminal,
      kind: "finished",
      workspace: "acme",
      project: "webshop",
      title: "Refactor billing",
      text: "Billing is split in two modules.",
      since: "2026-10-10T12:05:00.000Z",
    });
    expect(only({ agents: [agent()] })).not.toHaveProperty("text");
    expect(only({ agents: [agent({ lastMessage: " \n" })] })).not.toHaveProperty("text");
  });

  it("has its last words without credentials", () => {
    const wait = only({ agents: [agent({ lastMessage: `Set token=${token}\r\ndone` })] });
    expect(wait.text).toBe("Set token=[redacted]\ndone");
  });

  it("began its wait when its state did, if that is known", () => {
    const wait = only({ agents: [agent({ statusAt: "2026-10-10T11:30:00.000Z" })] });
    expect(wait.since).toBe("2026-10-10T11:30:00.000Z");
  });

  it("waits for nobody while it works, is idle or is unknown", () => {
    for (const status of ["working", "idle", "unknown"] as const) {
      expect(keys({ agents: [agent({ agent: herdr({ status }) })] }), status).toEqual([]);
    }
  });

  it("is told by its terminal until its session is known", () => {
    const byTerminal = agent({ agent: herdr({ id: "herdr:term-1", session: undefined }) });
    const wait = only({ agents: [byTerminal] });
    expect(wait.waitKey).toBe("herdr:term-1:done:4");
    expect(wait.subject.key).toBe("herdr:term-1");
    expect(wait.subject).not.toHaveProperty("previous");
  });

  it("keeps its Slack thread when its session becomes known", () => {
    // Still listed by its terminal's id: that id is the key it had before.
    const moving = agent({ agent: herdr({ id: "herdr:term-1" }) });
    const wait = only({ agents: [moving] });
    expect(wait.subject.key).toBe("herdr:claude:sess-1");
    expect(wait.subject.previous).toBe("herdr:term-1");
    expect(wait.waitKey).toBe("herdr:claude:sess-1:done:4");
    // Listed by its session, with the terminal's id remembered by whoever calls.
    const remembered = agent({ previousId: "herdr:term-1" });
    expect(only({ agents: [remembered] }).subject.previous).toBe("herdr:term-1");
    // Nothing comes before a key that was always its own.
    expect(only({ agents: [agent()] }).subject).not.toHaveProperty("previous");
    const same = agent({ previousId: "herdr:claude:sess-1" });
    expect(only({ agents: [same] }).subject).not.toHaveProperty("previous");
  });

  it("is called by its kind, in the words of people", () => {
    const kindOf = (kind: string | undefined) =>
      only({ agents: [agent({ agent: herdr({ agent: kind }) })] });
    expect(kindOf("claude").subject.agent).toBe("Claude Code");
    expect(kindOf("codex").subject.agent).toBe("Codex");
    expect(kindOf("opencode").subject.agent).toBe("OpenCode");
    expect(kindOf("gemini").subject.agent).toBe("Gemini");
    expect(kindOf(undefined).subject.agent).toBe("Agent");
    // herdr's own name for an agent of no kind, as the herdr plugin builds its ids.
    const unnamed = herdr({ agent: undefined, id: "herdr:agent:sess-1" });
    expect(only({ agents: [agent({ agent: unnamed })] }).subject.key).toBe("herdr:agent:sess-1");
  });

  it("counts turn 0 when herdr numbers none", () => {
    expect(keys({ agents: [agent({ agent: herdr({ turn: undefined }) })] })).toEqual([
      "herdr:claude:sess-1:done:0",
    ]);
  });
});

describe("the title and the task of a wait", () => {
  const titled = (over: Partial<SlackPlace>, shellOver: Partial<SlackShell> = {}) =>
    only({
      threads: [
        approving("Go?", { shell: asking("command", shellOver), place: { ...place, ...over } }),
      ],
    });

  it("is the task's key and title when the work is on a task", () => {
    const wait = titled({ task });
    expect(wait.title).toBe("APP-7 Ship checkout");
    expect(wait.subject.title).toBe("APP-7 Ship checkout");
    expect(wait.task).toStrictEqual(task);
    const keyless = titled({ task: { id: "t", title: "Only a title" } });
    expect(keyless.title).toBe("Only a title");
    expect(keyless.task).toStrictEqual({ id: "t", title: "Only a title" });
    const agentOnTask = only({ agents: [agent({ place: { ...place, task } })] });
    expect(agentOnTask.title).toBe("APP-7 Ship checkout");
    expect(agentOnTask.subject.title).toBe("APP-7 Ship checkout");
  });

  it("is the thread's or agent's own title without a task, or a word when it has none", () => {
    expect(titled({}).title).toBe("Fix the login");
    expect(titled({})).not.toHaveProperty("task");
    expect(titled({}, { title: "" }).title).toBe("Peer thread");
    expect(only({ agents: [agent({ agent: herdr({ title: "" }) })] }).title).toBe("Claude Code");
  });

  it("is one line without control characters or credentials, cut to 120", () => {
    const messy = `  Fix\n the${characters(0x00, 0x202e)}\tlogin with ${token}  `;
    expect(titled({}, { title: messy }).title).toBe("Fix the login with [redacted]");
    expect(titled({}, { title: "t".repeat(300) }).title).toHaveLength(120);
    expect(titled({ task: { id: "t", key: `K${token}`, title: "T" } }).task).toStrictEqual({
      id: "t",
      key: "K[redacted]",
      title: "T",
    });
  });

  it("names the computer on one line, or says this computer", () => {
    const named = (computer: string) => only({ threads: [approving()], computer }).subject.computer;
    expect(named(`Ana's\nMac${characters(0x07)}Book`)).toBe("Ana's MacBook");
    expect(named(" ")).toBe("this computer");
  });
});

describe("the keys of waits", () => {
  const everything = (over: Partial<SlackWaitInput> = {}) =>
    input({
      threads: [
        approving("Run npm test?"),
        done({ shell: finished({ id: ThreadId.make("thread-2"), title: "Second" }) }),
      ],
      agents: [
        agent({ agent: herdr({ status: "blocked" }) }),
        agent({ agent: herdr({ id: "herdr:claude:sess-2", session: "sess-2", turn: 2 }) }),
      ],
      ...over,
    });
  const everyKey = (over: Partial<SlackWaitInput> = {}) =>
    slackWaits(everything(over)).map((wait) => wait.waitKey);

  it("are the same on every call for the same state, threads first and then agents", () => {
    expect(slackWaits(everything())).toStrictEqual(slackWaits(everything()));
    expect(everyKey()).toEqual([
      "peer:thread-1:req:req-1",
      "peer:thread-2:run:run-1",
      "herdr:claude:sess-1:blocked:4",
      "herdr:claude:sess-2:done:2",
    ]);
  });

  it("do not depend on titles, texts, the time or the order of the lists", () => {
    const base = everyKey();
    const reworded = everyKey({
      threads: [
        approving("Another prompt", { shell: asking("command", { title: "Another title" }) }),
        done({
          shell: finished({ id: ThreadId.make("thread-2"), title: "Renamed" }),
          latestMessage: { role: "assistant", text: "Said it differently" },
        }),
      ],
      agents: [
        agent({ agent: herdr({ status: "blocked", title: "Other" }), lastMessage: "x" }),
        agent({
          agent: herdr({ id: "herdr:claude:sess-2", session: "sess-2", turn: 2, title: "Other" }),
          lastMessage: "y",
        }),
      ],
      now: "2026-10-11T00:00:00.000Z",
      computer: "Another computer",
    });
    expect(reworded).toEqual(base);
    const reversed = everyKey({
      threads: everything().threads.toReversed(),
      agents: everything().agents.toReversed(),
    });
    expect(reversed.toSorted()).toEqual(base.toSorted());
  });

  it("change with the request, the run and the turn, which are other decision points", () => {
    const second = asking("command", {
      pendingRuntimeRequest: {
        id: RuntimeRequestId.make("req-2"),
        kind: "command",
        createdAt: at("2026-10-10T11:59:00Z"),
      },
    });
    const request: SlackRequest = { kind: "approval", requestId: "req-2", prompt: "Again?" };
    expect(keys({ threads: [thread({ shell: second, request })] })).toEqual([
      "peer:thread-1:req:req-2",
    ]);
    const secondRun = done({ shell: finished({ latestRunId: RunId.make("run-2") }) });
    expect(keys({ threads: [secondRun] })).toEqual(["peer:thread-1:run:run-2"]);
    expect(keys({ agents: [agent({ agent: herdr({ turn: 5 }) })] })).toEqual([
      "herdr:claude:sess-1:done:5",
    ]);
    // Blocked and done are two decision points of one turn.
    const blocked = keys({ agents: [agent({ agent: herdr({ status: "blocked" }) })] });
    expect(blocked).toEqual(["herdr:claude:sess-1:blocked:4"]);
  });

  it("tell a thread's decision points from an agent's, and are never shared", () => {
    const all = everyKey();
    expect(new Set(all).size).toBe(all.length);
    expect(all.filter((key) => key.startsWith("peer:"))).toHaveLength(2);
    expect(all.filter((key) => key.startsWith("herdr:"))).toHaveLength(2);
  });

  it("are nothing when no workspace has Slack", () => {
    expect(everyKey({ connectedWorkspaces: new Set() })).toEqual([]);
    expect(slackWaits(input())).toEqual([]);
  });
});
