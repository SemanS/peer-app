import { targetsFor } from "@t3tools/client-runtime/peer/rooms";
import type { PeerRoomMessage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  lastAgentReply,
  snapshotLine,
  authorOf,
  canSend,
  choicesWithMentions,
  chosenKeys,
  deliveryTone,
  draftAfter,
  draftIdentity,
  draftProblem,
  EMPTY_DRAFT,
  insertMention,
  isEmptyDraft,
  matchPeople,
  mentionAt,
  operationFor,
  parseDraft,
  peopleOf,
  moveKey,
  reachRows,
  recipientsOf,
  sendNotice,
  toggleChoice,
  lastOfRuns,
  runActivity,
  stepLine,
  turnDone,
  withPaths,
} from "./room.logic";

const members = [
  { email: "me@acme.test", name: "Me", role: "member" },
  { email: "ana@acme.test", name: "Ana", role: "member" },
  { email: "bob@acme.test", name: "Bob", role: "member" },
];
const project = { members } as never;
const task = { id: "t1", createdBy: "ana@acme.test" };
const run = (email: string, state: string, id = `run-${email}`) => ({
  id,
  task: "t1",
  email,
  state,
  agent: "claude",
});
const nameOf = (email: string) => members.find((m) => m.email === email)?.name ?? email;
const choices = (options: Parameters<typeof targetsFor>[4] = {}) =>
  targetsFor(project, task, [run("ana@acme.test", "running")] as never, "me@acme.test", options);

describe("the To row", () => {
  it("defaults to Team, which names nobody", () => {
    expect(chosenKeys(EMPTY_DRAFT)).toEqual(["team"]);
    expect(recipientsOf(choices(), [])).toEqual({ to: [], notes: [], blocked: null });
  });

  it("drops Team when another chip is chosen and comes back to it from Team", () => {
    const agent = choices().find((choice) => choice.key === "agent:ana@acme.test");
    const team = choices()[0];
    if (agent === undefined || team === undefined) throw new Error("missing choices");
    const selected = toggleChoice([], agent);
    expect(chosenKeys({ selected })).toEqual(["agent:ana@acme.test"]);
    expect(toggleChoice(selected, agent)).toEqual([]);
    expect(toggleChoice(selected, team)).toEqual([]);
  });

  it("names several at once and says what a colleague's agent needs before sending", () => {
    const { to, notes } = recipientsOf(choices(), ["own-agent", "agent:ana@acme.test"]);
    expect(to).toEqual([
      { kind: "agent", email: "me@acme.test" },
      { kind: "agent", email: "ana@acme.test" },
    ]);
    expect(notes).toEqual([
      "This starts your agent on this computer, read-only, on your capacity.",
      "Ana decides whether to pass this on.",
    ]);
  });

  it("does not let a disabled Your agent be chosen, and blocks a draft that chose it earlier", () => {
    const none = choices({ hasCheckout: false });
    const own = none.find((choice) => choice.kind === "own-agent");
    if (own === undefined) throw new Error("missing own agent");
    expect(own.disabled).toBe("This computer has no checkout of the project.");
    expect(toggleChoice([], own)).toEqual([]);
    const { blocked } = recipientsOf(none, ["own-agent"]);
    expect(blocked).toBe(own.disabled);
    expect(canSend("hello", blocked)).toBe(false);
  });

  it("blocks a draft whose chosen person left the list, rather than post to the team", () => {
    const { to, blocked } = recipientsOf(choices(), ["agent:gone@acme.test"]);
    expect(to).toEqual([]);
    expect(blocked).toContain("no longer on this task");
    expect(canSend("hello", blocked)).toBe(false);
  });

  it("keeps a chip for a mentioned member who is not on the task", () => {
    const people = peopleOf(members, "me@acme.test", nameOf);
    const shown = choicesWithMentions(choices(), people, ["person:bob@acme.test"]);
    expect(shown.at(-1)).toMatchObject({ label: "Bob", to: [{ email: "bob@acme.test" }] });
    expect(choicesWithMentions(choices(), people, [])).toHaveLength(choices().length);
  });
});

describe("a draft", () => {
  it("cannot go empty, blank or over the Hub's bound", () => {
    expect(canSend("", null)).toBe(false);
    expect(canSend("   \n", null)).toBe(false);
    expect(canSend("x".repeat(4_001), null)).toBe(false);
    expect(draftProblem("x".repeat(4_001), null)).toContain("4,000");
    expect(canSend("x".repeat(4_000), null)).toBe(true);
  });

  it("stays through a failed or unknown send and leaves on a confirmed one", () => {
    const draft = { text: "hi", selected: ["own-agent"] };
    expect(draftAfter(draft, { kind: "failed", reason: "No" })).toBe(draft);
    expect(draftAfter(draft, { kind: "unknown" })).toBe(draft);
    expect(draftAfter(draft, { kind: "sent" })).toEqual(EMPTY_DRAFT);
  });

  it("says plainly what happened to a send that did not land", () => {
    expect(sendNotice({ kind: "sent" })).toBeNull();
    expect(sendNotice({ kind: "failed", reason: "Too many waiting." })).toBe(
      "Not sent: Too many waiting. Your message is still here.",
    );
    expect(sendNotice({ kind: "unknown" })).toContain("still here");
  });

  it("keeps its operation on a retry and takes a new one once edited", () => {
    let minted = 0;
    const mint = () => `op-${++minted}`;
    const first = operationFor(undefined, draftIdentity({ text: "hi" }, []), mint);
    const retry = operationFor(first, draftIdentity({ text: " hi " }, []), mint);
    expect(retry).toBe(first);
    const edited = operationFor(first, draftIdentity({ text: "hi there" }, []), mint);
    expect(edited.id).toBe("op-2");
    const anchored = operationFor(
      first,
      draftIdentity({ text: "hi", anchor: { path: "a", line: 1, side: "new" } }, []),
      mint,
    );
    expect(anchored.id).toBe("op-3");
  });

  it("comes back from storage whole, and anything unreadable reads as empty", () => {
    const draft = {
      text: "hi",
      selected: ["team"],
      anchor: { path: "a.ts", line: 3, side: "new" },
      operation: { draft: "d", id: "op" },
    };
    expect(parseDraft(JSON.stringify(draft))).toEqual(draft);
    expect(parseDraft(null)).toEqual(EMPTY_DRAFT);
    expect(parseDraft("{not json")).toEqual(EMPTY_DRAFT);
    expect(parseDraft('{"text":1}')).toEqual(EMPTY_DRAFT);
    expect(parseDraft('{"text":"x","selected":[1,"a"],"anchor":{"path":1}}')).toEqual({
      text: "x",
      selected: ["a"],
    });
  });

  it("is empty only with no words, recipients or line", () => {
    expect(isEmptyDraft(EMPTY_DRAFT)).toBe(true);
    expect(isEmptyDraft({ text: "", selected: ["own-agent"] })).toBe(false);
  });
});

describe("@ in the text", () => {
  const people = peopleOf(members, "me@acme.test", nameOf);

  it("is a mention at the start of a word and not inside an address", () => {
    expect(mentionAt("hi @an", 6)).toEqual({ start: 3, query: "an" });
    expect(mentionAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionAt("mail ana@acme", 13)).toBeNull();
    expect(mentionAt("hi @an there", 12)).toBeNull();
  });

  it("offers people by name or address, never the writer", () => {
    expect(matchPeople(people, "").map((person) => person.label)).toEqual(["Ana", "Bob"]);
    expect(matchPeople(people, "bo").map((person) => person.label)).toEqual(["Bob"]);
    expect(matchPeople(people, "ana@").map((person) => person.label)).toEqual(["Ana"]);
  });

  it("replaces what was typed and puts the caret after the name", () => {
    expect(insertMention("hi @an!", { start: 3 }, "Ana", 6)).toEqual({
      text: "hi @Ana !",
      caret: 8,
    });
  });
});

describe("paths in a draft", () => {
  it("adds them after the words, each one readable as a path", () => {
    expect(withPaths("", ["src/a.ts"])).toBe("`src/a.ts` ");
    expect(withPaths("What about", ["src/", "b.ts"])).toBe("What about `src/` `b.ts` ");
    expect(withPaths("Why\n", ["b.ts"])).toBe("Why\n`b.ts` ");
  });

  it("leaves no @ open, so the people list stays shut", () => {
    const text = withPaths("", ["src/@scope/a.ts"]);
    expect(mentionAt(text, text.length)).toBeNull();
  });
});

describe("a run in the conversation", () => {
  const options = { review: false, jujutsu: true };

  it("says where a run stands", () => {
    expect(runActivity({ agent: "claude", state: "running" }, options)).toMatchObject({
      kind: "working",
      title: "Claude · Implementation",
      detail: "Jujutsu workspace",
    });
    expect(
      runActivity(
        { agent: "codex", state: "ended", outcome: "done" },
        { review: true, jujutsu: false },
      ),
    ).toMatchObject({ kind: "delivered", title: "Codex · Review", detail: "Review ready" });
  });

  it("does not call work delivered that was stopped or left", () => {
    expect(runActivity({ agent: "claude", state: "detached" }, options).word).toBe("Idle");
    expect(runActivity({ agent: "claude", state: "ended", outcome: "stopped" }, options).kind).toBe(
      "stopped",
    );
  });

  it("does not call an agent working that waits for the next message", () => {
    const run = { agent: "claude", state: "running" } as const;
    expect(runActivity(run, { ...options, threadWorking: false }).word).toBe("Done");
    expect(runActivity(run, { ...options, threadWorking: true }).word).toBe("Working");
  });

  it("keeps an earlier reply done, with a name even when its run is gone", () => {
    expect(turnDone("codex", true)).toMatchObject({ word: "Done", title: "Codex · Review" });
    expect(turnDone(undefined, false).title).toBe("Agent · Implementation");
  });

  it("finds the message that speaks for each run", () => {
    const by = (seq: number, run?: string) => ({
      seq,
      author: { email: "a@b.c", ...(run === undefined ? {} : { run }) },
    });
    expect(lastOfRuns([by(1, "r1"), by(2), by(3, "r2"), by(4, "r1")])).toEqual(
      new Map([
        ["r1", 4],
        ["r2", 3],
      ]),
    );
  });
});

describe("a step in a line", () => {
  it("names the file and how much moved", () => {
    expect(stepLine({ files: ["src/a/concurrency.ts"], added: 12, removed: 3 })).toEqual({
      name: "concurrency.ts",
      counts: "+12 −3",
    });
    expect(stepLine({ files: ["a.ts", "b.ts", "c.ts"], added: 1, removed: 0 })).toEqual({
      name: "a.ts +2",
      counts: "+1",
    });
  });
});

describe("who wrote a message", () => {
  it("reads as the person, or as the person's agent with its name", () => {
    const person = { author: { email: "ana@acme.test" } };
    const agent = { author: { email: "ana@acme.test", run: "r1", agent: "claude" } };
    expect(authorOf(person, "me@acme.test", nameOf)).toMatchObject({
      kind: "person",
      name: "Ana",
    });
    expect(authorOf(agent, "me@acme.test", nameOf)).toMatchObject({
      kind: "agent",
      name: "Ana's agent",
      harness: "claude",
    });
    expect(authorOf(agent, "ana@acme.test", nameOf).name).toBe("Your agent");
    expect(authorOf(person, "ana@acme.test", nameOf).name).toBe("You");
  });
});

describe("a delivery's tone", () => {
  const target = (state: string, extra = {}): PeerRoomMessage["to"][number] => ({
    kind: "agent",
    email: "ana@acme.test",
    state,
    ...extra,
  });

  it("marks what needs a person, what an agent has, and what ended", () => {
    expect(deliveryTone(target("waiting"), 0)).toBe("needs");
    expect(deliveryTone(target("failed"), 0)).toBe("needs");
    expect(deliveryTone(target("taken"), 0)).toBe("needs");
    expect(deliveryTone(target("taken", { run: "r1" }), 0)).toBe("working");
    expect(deliveryTone(target("heard", { run: "r1" }), 0)).toBe("working");
    expect(deliveryTone(target("answered"), 0)).toBe("delivery");
    expect(deliveryTone(target("declined"), 0)).toBe("neutral");
    expect(deliveryTone(target("from-a-newer-hub"), 0)).toBe("neutral");
  });
});

describe("the reach switch", () => {
  const me = "me@acme.test";
  const runs = [run(me, "running", "r1"), run(me, "ended", "r2"), run("ana@acme.test", "running")];

  it("shows the person's open runs only", () => {
    const rows = reachRows(runs as never, me, { reaches: [], capacities: { r1: "shared" } });
    expect(rows.map((row) => row.run)).toEqual(["r1"]);
    expect(rows[0]).toMatchObject({ team: false, unavailable: undefined });
  });

  it("gives a reason on personal capacity, and on a capacity Peer cannot tell", () => {
    const personal = reachRows(runs as never, me, { reaches: [], capacities: { r1: "personal" } });
    const untold = reachRows(runs as never, me, { reaches: [], capacities: {} });
    expect(personal[0]?.unavailable).toContain("own capacity");
    expect(untold[0]?.unavailable).toContain("cannot tell");
    expect(untold[0]?.unavailable).not.toContain("own capacity");
  });

  it("makes no claim on a switch that is on: it can always be turned off", () => {
    const rows = reachRows(runs as never, me, {
      reaches: [{ run: "r1", reach: "team" }],
      capacities: {},
    });
    expect(rows[0]).toMatchObject({ team: true, unavailable: undefined });
  });

  it("keeps two rooms' same message apart in a list of moves", () => {
    const place = { workspace: "w", project: "p", task: "t-1" };
    expect(moveKey(place, 1)).not.toBe(moveKey({ ...place, task: "t-2" }, 1));
  });

  it("reads a reach the Hub reports", () => {
    const rows = reachRows(runs as never, me, {
      reaches: [{ run: "r1", reach: "team" }],
      capacities: { r1: "shared" },
    });
    expect(rows[0]?.team).toBe(true);
  });
});

describe("snapshotLine", () => {
  it("says the change, how many more and the counts", () => {
    expect(
      snapshotLine({ changes: ["pxtwpnkoabcd", "qmwotkrz"], files: 2, added: 92, removed: 1 }),
    ).toEqual({ change: "pxtwpnko +1", counts: "2 files +92 −1" });
  });

  it("has no change to name when the agent made none", () => {
    expect(snapshotLine({ changes: [], files: 0, added: 0, removed: 0 })).toEqual({
      change: undefined,
      counts: "0 files",
    });
  });
});

describe("lastAgentReply", () => {
  const person = { seq: 3, author: { email: "ana@acme.test" } };
  const agent = (seq: number) => ({ seq, author: { email: "ana@acme.test", run: `run_${seq}` } });

  it("takes the newest agent's message, past a person's", () => {
    expect(lastAgentReply([agent(2), agent(1), person])?.seq).toBe(2);
  });

  it("has nothing to take in a room no agent answered", () => {
    expect(lastAgentReply([person])).toBeUndefined();
  });
});
