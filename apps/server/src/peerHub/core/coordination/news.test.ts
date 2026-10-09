import { assert, describe, it } from "@effect/vitest";

import { startContext } from "../contexts/text.ts";
import type { HubCoordSession, HubOverlap } from "../hub/hubApi.ts";
import type { BoardEntry } from "../index/text.ts";
import { type CoordinationView, emptyMemory, taskClaim } from "./edits.ts";
import {
  closerOf,
  newsFor,
  SETTLE_REQUEST,
  settleAskedAt,
  settleNudge,
  settleRequest,
  statusText,
} from "./news.ts";

const CLI = "/Users/ana/.peer/userdata/coord/peer";

const nameOf = (email: string) => (email.startsWith("vir") ? "Vir" : "Slavo");

function session(id: string, email: string, files: string[], extra: Partial<HubCoordSession> = {}) {
  return {
    id,
    project: "app",
    email,
    environment: "laptop",
    label: id === "claude:me" ? "Backend implementation" : "Frontend implementation",
    agent: "claude",
    status: "working",
    files,
    claims: [],
    seenAt: "2026-10-04T10:00:00Z",
    ...extra,
  } as HubCoordSession;
}

const me = session("claude:me", "slavo@acme.test", ["src/api.ts"]);

const vir = session("claude:vir", "vir@acme.test", ["src/pay.ts"], { branch: "krk-812-ui" });

function overlap(extra: Partial<HubOverlap> = {}): HubOverlap {
  return {
    id: "abc123def456",
    project: "app",
    sessions: ["claude:me", "claude:vir"],
    files: ["src/pay.ts"],
    state: "open",
    notes: [],
    openedAt: "2026-10-04T10:00:00Z",
    updatedAt: "2026-10-04T10:00:00Z",
    ...extra,
  };
}

const view = (overlaps: HubOverlap[] = []): CoordinationView => ({ sessions: [me, vir], overlaps });

describe("newsFor", () => {
  it("tells an agent about a new overlap and the other side's notes once", () => {
    const memory = emptyMemory();
    const noted = overlap({
      notes: [
        {
          id: "n1",
          session: "claude:vir",
          email: "vir@acme.test",
          text: "I rename price() to total()",
          at: "t",
        },
        { id: "n2", session: "claude:me", email: "slavo@acme.test", text: "my own note", at: "t" },
        { id: "n3", email: "vir@acme.test", text: "Vir here: rename first", at: "t" },
      ],
    });
    const news = newsFor({ me, view: view([noted]), memory, nameOf, cli: CLI });
    assert.include(
      news?.text,
      `Overlap abc123 with Vir's agent (Claude Code, "Frontend implementation", branch krk-812-ui), working on this computer, on src/pay.ts (they changed it too)`,
    );
    assert.include(news?.text, "Once you agree, close it");
    assert.include(news?.text, `Vir's agent: "I rename price() to total()"`);
    assert.include(news?.text, `Vir (person): "Vir here: rename first"`);
    assert.notInclude(news?.text, "my own note");
    for (const id of news?.announced ?? []) memory.announced.add(id);
    for (const id of news?.seen ?? []) memory.seenNotes.add(id);
    assert.isNull(newsFor({ me, view: view([noted]), memory, nameOf, cli: CLI }));
  });
});

describe("the project's other work", () => {
  const taskName = (task: string) =>
    task === "krk-812"
      ? "KRK-812 · Split payments"
      : task === "krk-900"
        ? "KRK-900 · Receipts"
        : task;

  const onTask = session("claude:vir", "vir@acme.test", ["src/pay.ts"], {
    task: "krk-812",
    environment: "vir-laptop",
  });

  const asking = session("claude:me", "slavo@acme.test", [], {
    task: "krk-900",
    claims: [taskClaim("krk-812")],
  });

  const entries: BoardEntry[] = [
    {
      scope: "task:krk-812",
      handle: "KRK-812",
      name: "KRK-812 · Split payments",
      agents: ["Vir's agent (Claude Code, idle 9 min, on another computer, 1 file(s) changed)"],
      keeper: "Vir's agent",
      version: 3,
      gist: "Split amounts live in Split.amounts; the API returns them in cents",
      path: "/c/shared/task_krk-812.md",
    },
    { scope: "task:x1", handle: "x1", name: "Receipts by mail", agents: [], version: 0 },
  ];

  it("tells the agents on a task who asks them, and the asker their answer", () => {
    const question = overlap({
      sessions: ["claude:me", "claude:vir"],
      files: ["task:krk-812"],
      notes: [
        {
          id: "q1",
          session: "claude:me",
          email: "slavo@acme.test",
          text: "Where do you keep split amounts?",
          at: "t",
        },
        {
          id: "a1",
          session: "claude:vir",
          email: "vir@acme.test",
          text: "In Split.amounts",
          at: "t",
        },
      ],
    });
    const both: CoordinationView = { sessions: [asking, onTask], overlaps: [question] };
    const asked = newsFor({
      me: onTask,
      view: both,
      memory: emptyMemory(),
      nameOf,
      taskName,
      cli: CLI,
    });
    assert.include(
      asked?.text,
      `Overlap abc123: Slavo's agent (Claude Code, on KRK-900 · Receipts, "Backend implementation"), working on another computer, so its edits reach you only through git, asks the agents on your task KRK-812 · Split payments — Slavo's agent: "Where do you keep split amounts?"`,
    );
    assert.notInclude(asked?.text, "about to change it");
    const answered = newsFor({
      me: asking,
      view: both,
      memory: emptyMemory(),
      nameOf,
      taskName,
      cli: CLI,
    });
    assert.include(
      answered?.text,
      `your question about KRK-812 · Split payments, to Vir's agent (Claude Code, on KRK-812 · Split payments, "Frontend implementation"), working on another computer`,
    );
    assert.include(answered?.text, `Vir's agent: "In Split.amounts"`);
    assert.include(answered?.text, `${CLI} resolve`);
  });

  it("shows peer status by work: the caller's own, then the rest of the project", () => {
    const text = statusText({
      me: asking,
      view: { sessions: [asking, onTask], overlaps: [] },
      nameOf,
      taskName,
      board: entries.slice(0, 1),
      cli: "peer",
    });
    assert.include(text, "you: Slavo's agent (Claude Code, on KRK-900 · Receipts");
    assert.include(text, "No other agent on your task.");
    assert.include(text, "Other work on this project:\n- KRK-812 · Split payments");
    assert.include(text, `peer ask <task> "<question>"`);
    assert.include(text, `peer index`);
    assert.include(text, `peer knowledge [<id or words>]`);
    assert.include(text, `peer find "<what you will do>"`);
  });

  it("names in the start text and peer status only the commands of the plugins that are on", () => {
    const start = startContext({
      own: { path: "/c/me.md", saved: undefined },
      shared: undefined,
      findings: [],
      agents: [],
      nameOf,
      on: () => false,
    });
    assert.include(
      start,
      "Choose relevant inputs yourself, even when your person did not mention another agent. Within your own task",
    );
    assert.include(start, "Ask an available agent through peer note;");
    assert.notInclude(start, "peer knowledge");
    assert.notInclude(start, "peer ask");
    const status = statusText({
      me: asking,
      view: { sessions: [asking], overlaps: [] },
      nameOf,
      cli: "peer",
      on: (command) => command === "find",
    });
    assert.include(
      status,
      'Commands: peer index · peer context [<task>] · peer find "<what you will do>" · peer note "<text>"',
    );
  });
});

describe("settling an overlap", () => {
  it("names one agent to close it, the same on every computer", () => {
    const files = overlap({ sessions: ["claude:vir", "claude:me"] });
    assert.strictEqual(closerOf(files, [vir, me]), "claude:me");
    assert.strictEqual(closerOf(files, [vir]), "claude:vir", "the one still at work");
    assert.isUndefined(closerOf(files, []));
    // A question about a task is closed by the agent that asked it.
    const question = overlap({ sessions: ["claude:me", "claude:vir"], files: ["task:krk-812"] });
    const onTask = { ...vir, task: "krk-812" };
    assert.strictEqual(closerOf(question, [{ ...me, task: "krk-900" }, onTask]), "claude:me");
    assert.strictEqual(
      closerOf({ ...question, sessions: ["claude:a", "claude:z"] }, [
        { id: "claude:a", task: "krk-812" },
        { id: "claude:z", task: undefined },
      ]),
      "claude:z",
    );
  });

  it("asks both agents to agree and names who closes it, with what the person adds", () => {
    const text = settleRequest({
      closer: "Vir's agent on KRK-812 · Split payments",
      message: "Payments first, please.",
      cli: "peer",
    });
    assert.isTrue(text.startsWith(SETTLE_REQUEST));
    assert.include(
      text,
      `then Vir's agent on KRK-812 · Split payments closes it: peer resolve "<agreement>"`,
    );
    assert.include(text, "If the other agent does not answer, close it with what you will do.");
    assert.isTrue(text.endsWith(" Payments first, please."));
  });

  it("knows a person asked until an agent writes again", () => {
    const asked = {
      text: `${SETTLE_REQUEST} agree…`,
      at: "2026-10-05T10:00:00Z",
    };
    assert.strictEqual(settleAskedAt([asked]), "2026-10-05T10:00:00Z");
    assert.isUndefined(settleAskedAt([asked, { session: "claude:vir", text: "ok", at: "t" }]));
    assert.isUndefined(settleAskedAt([{ text: "Bob first", at: "t" }]));
  });

  it("does not wake an agent only to say an overlap was closed", () => {
    const closed = overlap({
      state: "resolved",
      notes: [
        {
          id: "r1",
          session: "claude:vir",
          email: "vir@acme.test",
          text: "Resolved: Vir first",
          at: "t",
        },
      ],
    });
    const memory = emptyMemory();
    const waking = newsFor({ me, view: view([closed]), memory, nameOf, waking: true, cli: CLI });
    assert.isNull(waking);
    const next = newsFor({ me, view: view([closed]), memory, nameOf, cli: CLI });
    assert.include(next?.text, `Vir's agent: "Resolved: Vir first"`);
  });

  it("tells the closing agent to close a quiet overlap or say what is left", () => {
    const text = settleNudge({
      overlap: overlap(),
      other: "Vir's agent",
      minutes: 3,
      taskName: (task) => task,
      cli: "peer",
    });
    assert.include(text, "overlap abc123 with Vir's agent on src/pay.ts has been quiet for 3 min");
    assert.include(text, `close it now: peer resolve "<agreement>"`);
    assert.include(text, `peer note "<text>"`);
  });
});
