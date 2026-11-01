import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type * as EffectAcpSchema from "effect-acp/compat";

import {
  foldAcpSessionReplay,
  readAcpSessionHistory,
  turnsAfter,
  type AcpSessionHistory,
} from "./AcpSessionHistory.ts";

const replay = (lines: ReadonlyArray<unknown>) =>
  lines as ReadonlyArray<EffectAcpSchema.SessionUpdate>;

const text = (value: string) => ({ type: "text", text: value });

// Payloads recorded from `codex-acp` 2.5.0 and `claude-agent-acp` 0.99.1 over ACP v1, shortened.
const codexReplay = replay([
  { sessionUpdate: "available_commands_update", availableCommands: [] },
  { sessionUpdate: "session_info_update", title: "Odpovedz" },
  { sessionUpdate: "user_message_chunk", messageId: "user-1", content: text("JEDNA") },
  { sessionUpdate: "agent_message_chunk", messageId: "msg-1", content: text("JEDNA-CODEX") },
  { sessionUpdate: "user_message_chunk", messageId: "user-2", content: text("Spusti prikaz") },
  { sessionUpdate: "agent_message_chunk", messageId: "msg-2", content: text("Spúšťam ") },
  { sessionUpdate: "agent_message_chunk", messageId: "msg-2", content: text("príkaz.") },
  {
    sessionUpdate: "tool_call",
    toolCallId: "exec-1",
    name: "exec_command",
    kind: "execute",
    title: "echo DVA > kod2.txt",
    status: "completed",
    content: [{ type: "terminal", terminalId: "exec-1" }],
    rawInput: { command: "echo DVA > kod2.txt", cwd: "/tmp/p" },
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "exec-1",
    _meta: { terminal_exit: { exit_code: 0, signal: null, terminal_id: "exec-1" } },
  },
  { sessionUpdate: "agent_message_chunk", messageId: "msg-3", content: text("DVA-CODEX") },
  { sessionUpdate: "agent_message_chunk", content: text("Warning: This session was recorded") },
  { sessionUpdate: "session_info_update", _meta: { codex: { threadStatus: { type: "idle" } } } },
  { sessionUpdate: "usage_update", used: 27159, size: 258400 },
]);

const claudeWriteReplay = replay([
  { sessionUpdate: "user_message_chunk", messageId: "uuid-1", content: text("Vytvor subor") },
  {
    sessionUpdate: "tool_call",
    toolCallId: "toolu_1",
    name: "Write",
    kind: "edit",
    status: "pending",
    title: "Write kod.txt",
    rawInput: { file_path: "/tmp/p/kod.txt", content: "DVA" },
    content: [{ type: "diff", path: "/tmp/p/kod.txt", oldText: null, newText: "DVA" }],
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "toolu_1",
    status: "completed",
    rawOutput: "File created successfully",
  },
  { sessionUpdate: "agent_message_chunk", messageId: "msg_1", content: text("DVA-CLI") },
]);

const claudeCompactedReplay = replay([
  {
    sessionUpdate: "user_message_chunk",
    messageId: "summary",
    content: text(
      "This session is being continued from a previous conversation that ran out of context.",
    ),
  },
  { sessionUpdate: "agent_message_chunk", messageId: "msg_old", content: text("DVA-CLI") },
  { sessionUpdate: "user_message_chunk", messageId: "uuid-3", content: text("TRI") },
  { sessionUpdate: "agent_message_chunk", messageId: "msg_3", content: text("TRI-CLI") },
]);

describe("foldAcpSessionReplay", () => {
  it("turns a Codex replay into turns and ignores what is not history", () => {
    const history = foldAcpSessionReplay(codexReplay);

    expect(history.compacted).toBe(false);
    expect(history.turns).toEqual([
      {
        nativeMessageId: "user-1",
        text: "JEDNA",
        entries: [{ type: "assistant_text", nativeId: "msg-1", text: "JEDNA-CODEX" }],
      },
      {
        nativeMessageId: "user-2",
        text: "Spusti prikaz",
        entries: [
          { type: "assistant_text", nativeId: "msg-2", text: "Spúšťam príkaz." },
          {
            type: "command",
            nativeId: "exec-1",
            command: "echo DVA > kod2.txt",
            exitCode: 0,
            status: "completed",
          },
          { type: "assistant_text", nativeId: "msg-3", text: "DVA-CODEX" },
        ],
      },
    ]);
  });

  it("pairs a tool call with its update and maps a diff to a file change", () => {
    const [turn] = foldAcpSessionReplay(claudeWriteReplay).turns;

    expect(turn?.entries).toEqual([
      {
        type: "file_change",
        nativeId: "toolu_1",
        path: "/tmp/p/kod.txt",
        newText: "DVA",
        status: "completed",
      },
      { type: "assistant_text", nativeId: "msg_1", text: "DVA-CLI" },
    ]);
  });

  it("drops the summary and the reply replayed after it", () => {
    const history = foldAcpSessionReplay(claudeCompactedReplay);

    expect(history.compacted).toBe(true);
    expect(history.turns).toEqual([
      {
        nativeMessageId: "uuid-3",
        text: "TRI",
        entries: [{ type: "assistant_text", nativeId: "msg_3", text: "TRI-CLI" }],
      },
    ]);
  });

  it("marks a tool that never reached a terminal status as incomplete", () => {
    const [turn] = foldAcpSessionReplay(
      replay([
        { sessionUpdate: "user_message_chunk", messageId: "u", content: text("go") },
        {
          sessionUpdate: "tool_call",
          toolCallId: "t",
          name: "Grep",
          kind: "search",
          title: "grep",
          status: "in_progress",
          rawInput: { pattern: "x" },
        },
      ]),
    ).turns;

    expect(turn?.entries).toEqual([
      {
        type: "tool",
        nativeId: "t",
        name: "Grep",
        title: "grep",
        input: { pattern: "x" },
        status: "incomplete",
      },
    ]);
  });

  it("keeps ids unique when one tool touches several files", () => {
    const [turn] = foldAcpSessionReplay(
      replay([
        { sessionUpdate: "user_message_chunk", messageId: "u", content: text("go") },
        {
          sessionUpdate: "tool_call",
          toolCallId: "t",
          kind: "edit",
          title: "patch",
          status: "completed",
          content: [
            { type: "diff", path: "/a", newText: "a" },
            { type: "diff", path: "/b", newText: "b" },
          ],
        },
      ]),
    ).turns;

    expect(turn?.entries.map((entry) => entry.nativeId)).toEqual(["t", "t#1"]);
  });

  it("clips a field and a raw tool payload", () => {
    const long = "x".repeat(40_000);
    const [turn] = foldAcpSessionReplay(
      replay([
        { sessionUpdate: "user_message_chunk", messageId: "u", content: text(long) },
        {
          sessionUpdate: "tool_call",
          toolCallId: "t",
          kind: "read",
          title: "read",
          status: "completed",
          rawInput: { path: "/a" },
          rawOutput: { text: long },
        },
      ]),
    ).turns;

    expect(turn?.text.length).toBeLessThan(33_000);
    const entry = turn?.entries[0];
    expect(entry?.type === "tool" && typeof entry.output === "string").toBe(true);
    expect(entry?.type === "tool" && entry.input).toEqual({ path: "/a" });
  });
});

describe("turnsAfter", () => {
  const MAX_PROMPT = 2_000;
  const codex = foldAcpSessionReplay(codexReplay);
  const compacted = foldAcpSessionReplay(claudeCompactedReplay);

  it("returns the turns after a found anchor", () => {
    const after = turnsAfter(codex, "user-1");

    expect(after.gap).toBe("none");
    expect(after.turns.map((turn) => turn.nativeMessageId)).toEqual(["user-2"]);
  });

  it("returns nothing new when the anchor is the last turn", () => {
    expect(turnsAfter(codex, "user-2")).toEqual({ turns: [], gap: "none" });
  });

  it("returns every turn of a session that had no prompt", () => {
    expect(turnsAfter(codex, null).turns).toHaveLength(2);
    expect(turnsAfter(codex, null).gap).toBe("none");
  });

  it("says compacted when the anchor went with the compaction", () => {
    const after = turnsAfter(compacted, "uuid-gone");

    expect(after.gap).toBe("compacted");
    expect(after.turns.map((turn) => turn.nativeMessageId)).toEqual(["uuid-3"]);
  });

  it("finds an anchor that survived the compaction", () => {
    expect(turnsAfter(compacted, "uuid-3")).toEqual({ turns: [], gap: "none" });
  });

  it("says diverged when the anchor is on another branch", () => {
    expect(turnsAfter(codex, "other-branch")).toEqual({ turns: [], gap: "diverged" });
  });

  it("shrinks the end of an import past the budget and keeps every step", () => {
    const output = "o".repeat(30_000);
    const history: AcpSessionHistory = {
      compacted: false,
      turns: Array.from({ length: 200 }, (_, index) => ({
        nativeMessageId: `u${index}`,
        text: "go",
        entries: [
          {
            type: "command" as const,
            nativeId: `c${index}`,
            command: "ls",
            output,
            status: "completed" as const,
          },
        ],
      })),
    };

    const { turns } = turnsAfter(history, null);

    expect(turns).toHaveLength(200);
    expect(JSON.stringify(turns).length).toBeLessThan(4.2 * 1024 * 1024);
    expect(turns[0]?.entries[0]).toMatchObject({ output });
    const last = turns.at(-1)?.entries[0];
    expect(last?.type === "command" && last.output?.length).toBeLessThan(1_000);
  });

  const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
  const cap = 4 * 1024 * 1024;
  const command = (index: number, output: string) => ({
    type: "command" as const,
    nativeId: `c${index}`,
    command: "x",
    output,
    status: "completed" as const,
  });

  it("holds the cap when shrunken entries alone would pass it", () => {
    const output = "é".repeat(16_000);
    const history = {
      compacted: false,
      turns: Array.from({ length: 3 }, (_, turnIndex) => ({
        nativeMessageId: `user-${turnIndex}`,
        text: "go",
        entries: Array.from({ length: 4_000 }, (_, index) => command(index, output)),
      })),
    };

    const { turns, gap } = turnsAfter(history, null);

    expect(bytes(turns)).toBeLessThanOrEqual(cap);
    expect(gap).toBe("truncated");
  });

  it("holds the cap on prompts, and reports the turns it had to leave out", () => {
    const prompt = "p".repeat(MAX_PROMPT);
    const history = {
      compacted: false,
      turns: Array.from({ length: 20_000 }, (_, index) => ({
        nativeMessageId: `user-${index}`,
        text: prompt,
        entries: [],
      })),
    };

    const { turns, gap } = turnsAfter(history, null);

    expect(bytes(turns)).toBeLessThanOrEqual(cap);
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.length).toBeLessThan(20_000);
    expect(gap).toBe("truncated");
  });

  it("bounds the number of entries, however small they are", () => {
    const history = {
      compacted: false,
      turns: [
        {
          nativeMessageId: "user-1",
          text: "go",
          entries: Array.from({ length: 20_000 }, (_, index) => command(index, "")),
        },
      ],
    };

    const { turns, gap } = turnsAfter(history, null);

    expect(turns[0]?.entries).toHaveLength(5_000);
    expect(gap).toBe("truncated");
  });

  it("says nothing was lost when everything fit, and a cut outranks a compaction", () => {
    expect(turnsAfter(codex, null).gap).toBe("none");
    const long = {
      compacted: true,
      turns: [
        {
          nativeMessageId: "user-1",
          text: "go",
          entries: Array.from({ length: 6_000 }, (_, index) => command(index, "")),
        },
      ],
    };
    expect(turnsAfter(long, "gone").gap).toBe("truncated");
    expect(turnsAfter(long, null).gap).toBe("truncated");
  });

  it("reports a compaction when no position exists, whichever side of the loan it was on", () => {
    expect(turnsAfter(compacted, null).gap).toBe("compacted");
  });
});

/** An ACP agent on stdio. The body sees `send`, `method`, `id` and `message`. */
const fakeAgent = (body: string) => [
  "-e",
  `
  const fs = require("node:fs");
  const rl = require("node:readline").createInterface({ input: process.stdin });
  const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\\n");
  rl.on("line", (line) => {
    const message = JSON.parse(line);
    const { id, method } = message;
    ${body}
  });
  `,
];

const update = (value: unknown) => ({
  method: "session/update",
  params: { sessionId: "s", update: value },
});

const initialize = `
  if (method === "initialize") {
    send({ id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } });
    return;
  }
`;

const readFake = (body: string, timeout = Duration.seconds(10)) =>
  Effect.gen(function* () {
    return yield* readAcpSessionHistory({
      spawn: { command: process.execPath, args: fakeAgent(body), cwd: process.cwd() },
      cwd: process.cwd(),
      sessionId: "s",
      platform: yield* HostProcess.Platform,
      loadMeta: { claudeCode: { options: { settingSources: [] } } },
      timeout,
    });
  });

it.layer(NodeServices.layer)("readAcpSessionHistory", (it) => {
  it.effect("collects the replay up to the load response", () =>
    Effect.gen(function* () {
      const replayed = update({
        sessionUpdate: "user_message_chunk",
        messageId: "u1",
        content: text("hello"),
      });
      const otherSession = {
        method: "session/update",
        params: {
          sessionId: "child",
          update: { sessionUpdate: "user_message_chunk", messageId: "c", content: text("child") },
        },
      };
      const late = update({
        sessionUpdate: "user_message_chunk",
        messageId: "u2",
        content: text("late"),
      });
      const history = yield* readFake(`
        ${initialize}
        if (method === "session/load") {
          if (message.params._meta?.claudeCode?.options?.settingSources?.length !== 0) process.exit(9);
          send(${JSON.stringify(replayed)});
          send(${JSON.stringify(otherSession)});
          send({ id, result: {} });
          send(${JSON.stringify(late)});
          return;
        }
        if (method === "session/close") send({ id, result: {} });
      `);

      expect(history.turns.map((turn) => turn.nativeMessageId)).toEqual(["u1"]);
    }),
  );

  it.effect("refuses an agent that cannot load", () =>
    Effect.gen(function* () {
      const result = yield* readFake(`
        if (method === "initialize") send({ id, result: { protocolVersion: 1, agentCapabilities: { loadSession: false } } });
      `).pipe(Effect.result);

      expect(Result.isFailure(result) && result.failure._tag).toBe(
        "AcpSessionLoadUnsupportedError",
      );
    }),
  );

  it.effect("fails a load the agent refuses", () =>
    Effect.gen(function* () {
      const result = yield* readFake(`
        ${initialize}
        if (method === "session/load") send({ id, error: { code: -32002, message: "not found" } });
      `).pipe(Effect.result);

      expect(Result.isFailure(result) && result.failure._tag).toBe("AcpSessionReadError");
    }),
  );

  it.effect("keeps what the agent said when it refuses a load", () =>
    Effect.gen(function* () {
      const failure = yield* readFake(`
        ${initialize}
        if (method === "session/load") {
          send({ id, error: { code: -32600, message: "busy", data: { reason: "thread_active_writer" } } });
        }
      `).pipe(Effect.flip);

      expect(failure._tag === "AcpSessionReadError" && failure.agentRefusal).toEqual({
        message: "busy",
        data: { reason: "thread_active_writer" },
      });
    }),
  );

  it.effect("refuses what the agent asks and still finishes", () =>
    Effect.gen(function* () {
      const replayed = update({
        sessionUpdate: "user_message_chunk",
        messageId: "u1",
        content: text("hello"),
      });
      const history = yield* readFake(`
        ${initialize}
        if (method === "session/load") {
          send({ id: 77, method: "session/request_permission", params: { sessionId: "s" } });
          globalThis.pendingLoad = id;
          return;
        }
        if (id === 77 && message.error) {
          send(${JSON.stringify(replayed)});
          send({ id: globalThis.pendingLoad, result: {} });
          return;
        }
        if (id === 77) process.exit(9);
        if (method === "session/prompt") process.exit(9);
        if (method === "session/close") send({ id, result: {} });
      `);

      expect(history.turns).toHaveLength(1);
    }),
  );
});

it.live("gives up on an agent that never answers", () =>
  Effect.gen(function* () {
    const result = yield* readFake(initialize, Duration.millis(300)).pipe(Effect.result);

    expect(Result.isFailure(result) && result.failure._tag).toBe("AcpSessionReadTimeoutError");
  }).pipe(Effect.provide(NodeServices.layer)),
);
