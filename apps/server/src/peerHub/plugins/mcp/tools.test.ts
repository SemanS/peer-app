import { describe, expect, it } from "vite-plus/test";
import { tools, instructions } from "./tools.ts";

describe("coordination tool contracts", () => {
  it("keeps fourteen compact command-backed tools", () => {
    expect(tools.map((t) => t.name)).toEqual([
      "peer_status",
      "peer_index",
      "peer_context",
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
    ).toBeLessThanOrEqual(3600);
    expect(instructions.length).toBeLessThanOrEqual(700);
    expect(tools.every((t) => t.command === t.name.slice(5))).toBe(true);
  });
  it("uses the Mod argument names and preserves resources", () => {
    const args = (name: string, input: Record<string, unknown>) =>
      tools.find((t) => t.name === name)!.arguments(input);
    expect(args("peer_context", { work: "APP-1", version: 7 })).toEqual(["APP-1", "7"]);
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
      ["peer_index", { page: 0 }],
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
