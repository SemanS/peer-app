import { describe, expect, it } from "vite-plus/test";
import { CORE_COMMANDS } from "../registry.ts";
import {
  AGENT_TOOL_INSTRUCTIONS as instructions,
  CORE_AGENT_TOOLS as tools,
} from "./agentTools.ts";

describe("coordination tool contracts", () => {
  it("has one tool per core command an agent calls, plus the ask and knowledge tools", () => {
    // help and log are for people at a shell; ask and knowledge are plugin commands core carries.
    expect(new Set(tools.map((t) => t.command))).toEqual(
      new Set([
        ...CORE_COMMANDS.filter((command) => command !== "help" && command !== "log"),
        "ask",
        "knowledge",
      ]),
    );
    expect(new Set(tools.map((t) => t.command)).size).toBe(tools.length);
  });
  it("keeps compact command-backed tools", () => {
    expect(tools.map((t) => t.name)).toEqual([
      "peer_status",
      "peer_current",
      "peer_archive",
      "peer_evidence",
      "peer_index",
      "peer_context",
      "peer_inputs",
      "peer_ack",
      "peer_claim",
      "peer_release",
      "peer_note",
      "peer_resolve",
      "peer_ask",
      "peer_knowledge",
      "peer_task",
      "peer_share",
      "peer_review",
      "peer_done",
    ]);
    expect(
      JSON.stringify(
        tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      ).length,
    ).toBeLessThanOrEqual(5000);
    expect(instructions.length).toBeLessThanOrEqual(700);
    expect(tools.every((t) => t.command === t.name.slice(5))).toBe(true);
  });
  it("uses the Mod argument names and preserves resources", () => {
    const args = (name: string, input: Record<string, unknown>) =>
      tools.find((t) => t.name === name)!.arguments(input);
    expect(args("peer_context", { work: "APP-1", version: 7 })).toEqual(["APP-1", "7"]);
    expect(args("peer_context", { findings: true, findingCursor: "next" })).toEqual([
      "findings",
      "next",
    ]);
    const decisions = [{ id: "finding-1", status: "incorporated", reason: "Added the check" }];
    expect(args("peer_context", { decisions })).toEqual(["decide", JSON.stringify(decisions)]);
    expect(args("peer_ask", { work: "APP-1", question: "What changed?" })).toEqual([
      "APP-1",
      "What changed?",
    ]);
    expect(args("peer_note", { text: "Ana first", overlap: "ab" })).toEqual([
      "Ana first",
      "--overlap",
      "ab",
    ]);
    expect(args("peer_claim", { paths: ["resource:preview"] })).toEqual(["resource:preview"]);
    expect(args("peer_current", { work: "project-aggregate", limit: 20 })).toEqual([
      "project-aggregate",
      "--limit",
      "20",
    ]);
    expect(args("peer_archive", { history: true, topic: "parser", cursor: "next" })).toEqual([
      "--history",
      "true",
      "--topic",
      "parser",
      "--cursor",
      "next",
    ]);
    expect(args("peer_evidence", { cursor: "next", limit: 5 })).toEqual([
      "--cursor",
      "next",
      "--limit",
      "5",
    ]);
    expect(
      args("peer_inputs", { action: "recover", reason: "Source removed", drop: "task:gone" }),
    ).toEqual(["recover", "Source removed", "--drop", "task:gone"]);
    expect(args("peer_inputs", { action: "recover", reason: "Recheck after restart" })).toEqual([
      "recover",
      "Recheck after restart",
    ]);
    expect(
      args("peer_inputs", {
        action: "import",
        checkpoint: "cp-1",
        reason: "Fork inherited references",
      }),
    ).toEqual(["import", "cp-1", "Fork inherited references"]);
    expect(args("peer_task", {})).toEqual(["list"]);
    expect(args("peer_task", { action: "add", title: "Diarization", key: "STR-9" })).toEqual([
      "add",
      "Diarization",
      "--key",
      "STR-9",
    ]);
    expect(args("peer_task", { action: "set", task: "STR-9", status: "done", area: "" })).toEqual([
      "set",
      "STR-9",
      "--area",
      "",
      "--status",
      "done",
    ]);
    expect(args("peer_task", { action: "remove", task: "STR-9" })).toEqual(["remove", "STR-9"]);
  });
  it("rejects flags disguised as text and invalid bounded inputs", () => {
    for (const [name, args] of [
      ["peer_note", { text: "--overlap" }],
      ["peer_ask", { work: "APP-1", question: "--help" }],
      ["peer_claim", { paths: [] }],
      ["peer_claim", { paths: ["--help"] }],
      ["peer_claim", { paths: Array.from({ length: 51 }, () => "a") }],
      ["peer_context", { decisions: [{ id: "f", status: "incorporated" }] }],
      [
        "peer_context",
        {
          work: "OTHER",
          decisions: [{ id: "f", status: "dismissed", reason: "No longer relevant" }],
        },
      ],
      ["peer_context", { version: 7, findings: true }],
      ["peer_index", { page: 0 }],
      ["peer_current", { limit: 101 }],
      ["peer_evidence", { limit: 0 }],
      ["peer_inputs", { action: "recover" }],
      ["peer_inputs", { action: "status", drop: "task:gone" }],
      ["peer_inputs", { action: "import", checkpoint: "cp-1" }],
      ["peer_inputs", { action: "import", reason: "Restore" }],
      ["peer_status", { unexpected: true }],
      ["peer_task", { action: "add", task: "STR-9", title: "x" }],
      ["peer_task", { action: "list", title: "x" }],
      ["peer_task", { action: "set", task: "STR-9", status: "closed" }],
      ["peer_task", { action: "drop" }],
    ] as const) {
      expect(() => tools.find((t) => t.name === name)!.arguments(args)).toThrow();
    }
  });
});
