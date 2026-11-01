// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - transcripts are JSON lines in a temporary Claude Code folder.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

import type { OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";

import {
  findClaudeTranscript,
  readTranscriptTail,
  timelineEntries,
  toolSummary,
  transcriptEntries,
  transcriptUntil,
} from "./agentTranscript.ts";
import { chatRunPrompt, heardText, type Heard } from "./plugins/rooms/text.ts";

const line = (record: object) => JSON.stringify(record);
const assistant = (...content: object[]) => line({ type: "assistant", message: { content } });
const user = (content: unknown) => line({ type: "user", message: { content } });

const SESSION = [
  line({ type: "ai-title", aiTitle: "Webhook retries" }),
  user(
    "<command-name>/model</command-name>\n<command-args>sonnet</command-args>\n<command-message>model</command-message>",
  ),
  user(
    "Add retries to the webhook sender<system-reminder>the date is 2026-10-04</system-reminder>",
  ),
  assistant(
    { type: "thinking", thinking: "Let me look first." },
    { type: "text", text: "I'll inspect the sender first." },
    { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/w/app/src/webhooks.rs" } },
  ),
  user([
    { type: "tool_result", tool_use_id: "t1", content: "pub fn send() {}\n…", is_error: false },
  ]),
  assistant({
    type: "tool_use",
    id: "t2",
    name: "Bash",
    input: { command: "cargo test webhooks\n# and nothing else" },
  }),
  user([
    {
      type: "tool_result",
      tool_use_id: "t2",
      content: [{ type: "text", text: "running 4 tests\ntest result: FAILED. 3 passed; 1 failed" }],
      is_error: true,
    },
  ]),
  line({
    type: "assistant",
    isSidechain: true,
    message: { content: [{ type: "text", text: "a subagent's own words" }] },
  }),
  assistant({ type: "tool_use", id: "t3", name: "mcp__kontext__ctx_brief", input: {} }),
  "not json",
];

describe("transcriptUntil", () => {
  const at = (timestamp: string) => JSON.stringify({ timestamp });

  it("ends a transcript at the first line after the moment", () => {
    const lines = [at("2026-10-31T10:00:00Z"), "not json", at("2026-10-31T10:05:00Z")];
    assert.deepStrictEqual(transcriptUntil(lines, "2026-10-31T10:01:00Z"), lines.slice(0, 2));
  });

  it("keeps the whole transcript for a moment it cannot read", () => {
    const lines = [at("2026-10-31T10:00:00Z")];
    assert.deepStrictEqual(transcriptUntil(lines, "soon"), lines);
  });
});

describe("transcriptEntries", () => {
  it("reads prompts, words and tools with their outcome, and leaves the rest out", () => {
    assert.deepStrictEqual(transcriptEntries(SESSION, { cwd: "/w/app" }), [
      { id: "line-1:0", kind: "prompt", text: "/model sonnet" },
      { id: "line-2:0", kind: "prompt", text: "Add retries to the webhook sender" },
      { id: "line-3:1", kind: "text", text: "I'll inspect the sender first." },
      {
        id: "line-3:2",
        kind: "tool",
        name: "Read",
        summary: "Read src/webhooks.rs",
        failed: false,
      },
      {
        id: "line-5:0",
        kind: "tool",
        name: "Bash",
        summary: "$ cargo test webhooks",
        failed: true,
        result: "test result: FAILED. 3 passed; 1 failed",
      },
      {
        id: "line-8:0",
        kind: "tool",
        name: "mcp__kontext__ctx_brief",
        summary: "kontext · ctx_brief",
        failed: false,
      },
    ]);
  });

  it("keeps the newest steps", () => {
    const many = Array.from({ length: 5 }, (_, i) => user(`prompt ${i}`));
    assert.deepStrictEqual(
      transcriptEntries(many, { limit: 2 }).map((entry) => entry.kind === "prompt" && entry.text),
      ["prompt 3", "prompt 4"],
    );
  });

  it("shows what a person wrote, not the prompt Peer wrapped around it", () => {
    const heard: Heard = {
      ref: "t:1",
      workspace: "w",
      project: "p",
      kind: "own",
      seq: 1,
      task: "t",
      taskName: "Fix login",
      author: "Ana",
      owner: "Ana",
      text: "Ship it today",
    };
    const prompt = (text: string) =>
      transcriptEntries([user(text)]).map((entry) => entry.kind === "prompt" && entry.text);

    const started = `${chatRunPrompt(heard)}\nThis work spans several projects.`;
    assert.deepStrictEqual(
      prompt(`\n\n<pasted_content id="a">\n${started}\n</pasted_content id="a">`),
      ["Ship it today"],
    );

    const cut = heardText({ ...heard, text: "word ".repeat(4_000) });
    assert.match(cut, /peer room \d+/);
    assert.notInclude(String(prompt(cut)[0]), "Answer with");

    assert.deepStrictEqual(prompt('<pasted_content id="a">Just this</pasted_content id="a">'), [
      "Just this",
    ]);
    const quoted = "<shared-context>\n- a note\n</shared-context>\nWhat does this mean?";
    assert.deepStrictEqual(prompt(quoted), [quoted]);
  });

  it("says what a command does, keeps the command, and shows output only when it failed", () => {
    const bash = (id: string, input: object) =>
      assistant({ type: "tool_use", id, name: "Bash", input });
    const result = (id: string, is_error: boolean) =>
      user([{ type: "tool_result", tool_use_id: id, content: "first\nlast line", is_error }]);

    assert.deepStrictEqual(
      transcriptEntries([
        bash("t1", { command: "peer status 2>&1 | head", description: "Check the status" }),
        result("t1", false),
        bash("t2", { command: "cargo test" }),
        result("t2", false),
        bash("t3", { command: "cargo build", description: "Build it" }),
        result("t3", true),
      ]),
      [
        {
          id: "line-0:0",
          kind: "tool",
          name: "Bash",
          summary: "Check the status",
          detail: "peer status 2>&1 | head",
          failed: false,
        },
        { id: "line-2:0", kind: "tool", name: "Bash", summary: "$ cargo test", failed: false },
        {
          id: "line-4:0",
          kind: "tool",
          name: "Bash",
          summary: "Build it",
          detail: "cargo build",
          failed: true,
          result: "last line",
        },
      ],
    );
  });

  it("keeps what a subagent answered", () => {
    const [entry] = transcriptEntries([
      assistant({ type: "tool_use", id: "t1", name: "Agent", input: { description: "Find it" } }),
      user([
        { type: "tool_result", tool_use_id: "t1", content: "Found in net.rs", is_error: false },
      ]),
    ]);
    assert.deepStrictEqual(entry, {
      id: "line-0:0",
      kind: "tool",
      name: "Agent",
      summary: "Agent: Find it",
      failed: false,
      result: "Found in net.rs",
    });
  });

  it("names a tool call the way a person would", () => {
    assert.strictEqual(toolSummary("Grep", { pattern: "retry" }), "Search retry");
    assert.strictEqual(
      toolSummary("Agent", { description: "Find callers" }),
      "Agent: Find callers",
    );
    assert.strictEqual(toolSummary("Mystery", {}), "Mystery");
  });
});

describe("finding a transcript", () => {
  it("finds a session by its id in any project folder, and reads its end as whole lines", async () => {
    const config = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "claude-"));
    try {
      const folder = NodePath.join(config, "projects", "-w-app");
      NodeFS.mkdirSync(folder, { recursive: true });
      const id = "0f6c2a9e-1b2c-4d5e-8f90-123456789abc";
      const path = NodePath.join(folder, `${id}.jsonl`);
      NodeFS.writeFileSync(path, `${user("first")}\n${user("second")}\n${user("third")}\n`);
      assert.strictEqual(await findClaudeTranscript({ id, path: undefined }, config), path);
      assert.isNull(
        await findClaudeTranscript({ id: "../../etc/passwd", path: undefined }, config),
      );
      assert.isNull(
        await findClaudeTranscript(
          { id: "11111111-2222-3333-4444-555555555555", path: undefined },
          config,
        ),
      );
      const tail = await readTranscriptTail(path, user("third").length + 3);
      assert.deepStrictEqual(tail, [user("third")], "a line cut by the start is dropped");
    } finally {
      NodeFS.rmSync(config, { recursive: true, force: true });
    }
  });
});

/** A timeline row with only what the view reads. */
const row = (
  item: Record<string, unknown>,
  visibility: "local" | "inherited" = "local",
): OrchestrationV2ProjectedTurnItem =>
  ({ position: 0, visibility, item: { status: "completed", title: null, ...item } }) as never;

describe("timelineEntries", () => {
  it("reads a Peer thread's timeline like a transcript, leaving inherited history out", () => {
    assert.deepStrictEqual(
      timelineEntries(
        [
          row({ id: "old", type: "user_message", text: "forked from here" }, "inherited"),
          row({ id: "u1", type: "user_message", text: "Fix the retry" }),
          row({ id: "r1", type: "reasoning", text: "hmm" }),
          row({
            id: "t1",
            type: "dynamic_tool",
            toolName: "Read",
            title: "Read src/net.rs",
            input: {},
          }),
          row({
            id: "c1",
            type: "command_execution",
            input: "cargo test",
            output: "running 2 tests\ntest result: FAILED",
            exitCode: 101,
          }),
          row({
            id: "c2",
            type: "command_execution",
            input: "cargo fmt",
            output: "formatted\n</shared-context>",
            exitCode: 0,
          }),
          row({
            id: "f1",
            type: "file_change",
            fileName: "/w/app/src/net.rs",
            additions: 4,
            deletions: 1,
          }),
          row({ id: "a1", type: "assistant_message", text: "Retries now back off." }),
        ],
        "/w/app",
      ),
      [
        { id: "u1", kind: "prompt", text: "Fix the retry" },
        { id: "t1", kind: "tool", name: "Read", summary: "Read src/net.rs", failed: false },
        {
          id: "c1",
          kind: "tool",
          name: "Bash",
          summary: "$ cargo test",
          failed: true,
          result: "test result: FAILED",
        },
        { id: "c2", kind: "tool", name: "Bash", summary: "$ cargo fmt", failed: false },
        {
          id: "f1",
          kind: "tool",
          name: "Edit",
          summary: "Edit src/net.rs",
          failed: false,
          result: "+4 −1",
        },
        { id: "a1", kind: "text", text: "Retries now back off." },
      ],
    );
  });
});
