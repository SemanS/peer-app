import { assert, describe, it } from "@effect/vitest";

import type { HubCoordSession, HubOverlap } from "../hub/coordApi.ts";
import type { BoardEntry } from "../index/text.ts";
import { type CoordinationView, emptyMemory } from "./edits.ts";
import { newsFor, startText, statusText } from "./news.ts";

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
    openedAt: "2026-10-04T10:00:00Z",
    updatedAt: "2026-10-04T10:00:00Z",
    ...extra,
  };
}

const view = (overlaps: HubOverlap[] = []): CoordinationView => ({ sessions: [me, vir], overlaps });

describe("newsFor", () => {
  it("tells an agent once that an overlap exists, and again when files join it", () => {
    const memory = emptyMemory();
    const news = newsFor({ me, view: view([overlap()]), memory, nameOf, cli: CLI });
    assert.strictEqual(
      news?.text,
      `Peer: Overlap with Vir's agent (Claude Code, "Frontend implementation", branch krk-812-ui), working on this computer, on src/pay.ts (they changed it too). Tell them if it concerns your work: ${CLI} note "<text>". Details: ${CLI} status.`,
    );
    for (const id of news?.announced ?? []) memory.announced.add(id);
    assert.isNull(newsFor({ me, view: view([overlap()]), memory, nameOf, cli: CLI }));
    const grown = overlap({ files: ["src/pay.ts", "src/cart.ts"] });
    assert.include(
      newsFor({ me, view: view([grown]), memory, nameOf, cli: CLI })?.text,
      "on src/pay.ts, src/cart.ts",
    );
  });

  it("names no note while the room is off, and speaks of another agent it has not heard of", () => {
    const news = newsFor({
      me,
      view: { sessions: [me], overlaps: [overlap({ files: ["src/other.ts"] })] },
      memory: emptyMemory(),
      nameOf,
      cli: CLI,
      on: () => false,
    });
    assert.notInclude(news?.text, "note");
    assert.include(news?.text, "src/other.ts");
    assert.include(news?.text, "they are about to change it");
  });

  it("says nothing of an overlap between two others", () => {
    const others = overlap({ sessions: ["claude:vir", "claude:eva"] });
    assert.isNull(newsFor({ me, view: view([others]), memory: emptyMemory(), nameOf, cli: CLI }));
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
    claims: ["src/pay.ts"],
  });

  const entries: BoardEntry[] = [
    {
      scope: "task:krk-812",
      handle: "KRK-812",
      name: "KRK-812 · Split payments",
      agents: ["Vir's agent (Claude Code, idle 9 min, on another computer, 1 file(s) changed)"],
    },
    { scope: "task:x1", handle: "x1", name: "Receipts by mail", agents: [] },
  ];

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
    assert.notInclude(text, "You hold:");
    assert.notInclude(text, "Your task");
    const held = statusText({
      me: asking,
      view: { sessions: [asking], overlaps: [] },
      nameOf,
      taskName,
      cli: "peer",
      mine: {
        claims: ["src/pay.ts", "src/cart.ts"],
        task: { name: "KRK-900 · Receipts", status: "review" },
      },
    });
    assert.include(held, "You hold: src/pay.ts, src/cart.ts.");
    assert.include(held, "Your task KRK-900 · Receipts is review.");
    assert.notInclude(held, "unsupported");
    const old = statusText({
      me: asking,
      view: { sessions: [asking], overlaps: [] },
      nameOf,
      cli: "peer",
      unsupported: "Jujutsu 0.45.0 is older than the supported minimum 0.46.0.",
    });
    assert.include(
      old,
      "This checkout is unsupported: Jujutsu 0.45.0 is older than the supported minimum 0.46.0.",
    );
  });

  it("says at a start who the agent is, how to run Peer and who else is at work", () => {
    const start = startText({
      me: "Slavo's agent",
      cliPath: "/peer/bin/peer",
      startLines: ["Your room: peer room reads it."],
      index: "Also on this project now:\n- KRK-812 · Split payments — Vir's agent",
    });
    assert.deepStrictEqual(start.split("\n\n"), [
      "You are Slavo's agent here.",
      "Peer knows this session, its project and task: run `peer` (/peer/bin/peer) as is, with no names or IDs, and never ask your person for Peer commands. `peer status` shows who works on what, `peer claim <path>` says what you are about to touch, and `peer` lists all commands.",
      "Your room: peer room reads it.",
      "Also on this project now:\n- KRK-812 · Split payments — Vir's agent",
    ]);
    assert.include(startText({ tools: true }), "Use your peer_* tools");
    assert.notInclude(startText({ index: null }), "Also on this project");
  });

  it("names in peer status only the commands of the plugins that are on", () => {
    const status = statusText({
      me: asking,
      view: { sessions: [asking], overlaps: [] },
      nameOf,
      cli: "peer",
      on: (command) => command === "ask",
    });
    assert.include(
      status,
      'Commands: peer index · peer ask <task> "<question>" · peer claim <path>... [--intent "<why>"] · peer release',
    );
  });
});
