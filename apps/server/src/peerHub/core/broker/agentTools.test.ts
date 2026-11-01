import { describe, expect, it } from "vite-plus/test";
import { CORE_COMMANDS } from "../registry.ts";
import {
  AGENT_TOOL_INSTRUCTIONS as instructions,
  CORE_AGENT_TOOLS as tools,
} from "./agentTools.ts";

describe("coordination tool contracts", () => {
  it("has one tool per core command an agent calls, plus the ask and note tools", () => {
    // help and log are for people at a shell; ask and note are plugins' commands.
    expect(new Set(tools.map((t) => t.command))).toEqual(
      new Set([
        ...CORE_COMMANDS.filter((command) => command !== "help" && command !== "log"),
        "ask",
        "note",
      ]),
    );
    expect(new Set(tools.map((t) => t.command)).size).toBe(tools.length);
  });
  it("keeps compact command-backed tools", () => {
    expect(tools.map((t) => t.name)).toEqual([
      "peer_status",
      "peer_index",
      "peer_claim",
      "peer_release",
      "peer_note",
      "peer_ask",
      "peer_task",
      "peer_share",
      "peer_run",
    ]);
    expect(
      JSON.stringify(
        tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      ).length,
      // 5000 before the task tree's five peer_task fields, 5200 before peer_run and peer_task show.
    ).toBeLessThanOrEqual(5350);
    expect(instructions.length).toBeLessThanOrEqual(700);
    expect(tools.every((t) => t.command === t.name.slice(5))).toBe(true);
  });
  it("uses the Mod argument names and preserves resources", () => {
    const args = (name: string, input: Record<string, unknown>) =>
      tools.find((t) => t.name === name)!.arguments(input);
    expect(args("peer_ask", { work: "APP-1", question: "What changed?" })).toEqual([
      "APP-1",
      "What changed?",
    ]);
    // One task's view carries its runs.
    expect(args("peer_task", { action: "show", task: "APP-1" })).toEqual(["show", "APP-1"]);
    expect(args("peer_run", {})).toEqual([]);
    expect(args("peer_note", { text: "Ana first" })).toEqual(["Ana first"]);
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
  it("maps peer_task's tree fields to peer task's flags", () => {
    const args = (input: Record<string, unknown>) =>
      tools.find((t) => t.name === "peer_task")!.arguments(input);
    expect(args({ action: "list", flat: true })).toEqual(["list", "--flat"]);
    expect(args({ action: "list", flat: false })).toEqual(["list"]);
    expect(
      args({ action: "add", title: "Hub", under: "STR-1", kind: "group", executable: false }),
    ).toEqual(["add", "Hub", "--under", "STR-1", "--kind", "group", "--not-executable"]);
    expect(args({ action: "add", title: "Step", executable: true })).toEqual(["add", "Step"]);
    expect(
      args({ action: "set", task: "t2", under: "none", executable: true, position: 0 }),
    ).toEqual(["set", "t2", "--under", "none", "--executable", "yes", "--position", "0"]);
    expect(args({ action: "set", task: "t2", executable: false })).toEqual([
      "set",
      "t2",
      "--executable",
      "no",
    ]);
    const schema = tools.find((t) => t.name === "peer_task")!;
    expect(Object.keys(schema.inputSchema.properties as object)).toEqual(
      expect.arrayContaining(["under", "kind", "executable", "position", "flat"]),
    );
    expect(schema.description).toContain("group");
  });
  it("rejects flags disguised as text and invalid bounded inputs", () => {
    for (const [name, args] of [
      ["peer_note", { text: "--overlap" }],
      ["peer_note", { text: "Ana first", overlap: "ab" }],
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
      ["peer_task", { action: "list", under: "STR-1" }],
      ["peer_task", { action: "add", title: "x", position: 1 }],
      ["peer_task", { action: "add", title: "x", kind: "epic" }],
      ["peer_task", { action: "add", title: "x", kind: "group", executable: true }],
      ["peer_task", { action: "set", task: "t1", flat: true }],
      ["peer_task", { action: "set", task: "t1", position: -1 }],
      ["peer_task", { action: "set", task: "t1", position: 1.5 }],
      ["peer_task", { action: "set", task: "t1", executable: "yes" }],
      ["peer_task", { action: "set", task: "t1", under: "--status" }],
      ["peer_task", { action: "remove", task: "t1", under: "t2" }],
    ] as const) {
      expect(() => tools.find((t) => t.name === name)!.arguments(args)).toThrow();
    }
  });
});
