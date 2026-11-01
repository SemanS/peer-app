import type { PeerAgentEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { agentTimelineRows } from "./AgentTimeline.logic";

const tool = (id: string, name: string, failed = false): PeerAgentEntry => ({
  id,
  kind: "tool",
  name,
  summary: id,
  failed,
});
const said = (id: string): PeerAgentEntry => ({ id, kind: "text", text: id });

const labels = (entries: ReadonlyArray<PeerAgentEntry>) =>
  agentTimelineRows(entries).map((row) => (row.kind === "tools" ? row.label : row.entry.id));

describe("agentTimelineRows", () => {
  it("joins tools used one after another, and only those", () => {
    expect(
      labels([
        tool("a", "Read"),
        said("b"),
        tool("c", "Bash"),
        tool("d", "Bash"),
        said("e"),
        tool("f", "Grep"),
      ]),
    ).toEqual(["a", "b", "Ran 2 commands", "e", "f"]);
  });

  it("says what kind of steps a group holds, and how many failed", () => {
    expect(labels([tool("a", "Read"), tool("b", "Read")])).toEqual(["Read 2 files"]);
    expect(labels([tool("a", "Edit"), tool("b", "Write")])).toEqual(["Made 2 edits"]);
    expect(labels([tool("a", "Grep"), tool("b", "Glob")])).toEqual(["Ran 2 searches"]);
    expect(labels([tool("a", "Read"), tool("b", "Bash")])).toEqual(["Used 2 tools"]);
    expect(labels([tool("a", "mcp__x__y"), tool("b", "mcp__x__z")])).toEqual(["Used 2 tools"]);
    expect(labels([tool("a", "Bash"), tool("b", "Bash", true)])).toEqual([
      "Ran 2 commands · 1 failed",
    ]);
  });

  it("keeps every step of a group in order", () => {
    const [row] = agentTimelineRows([tool("a", "Bash"), tool("b", "Bash")]);
    expect(row?.kind === "tools" ? row.tools.map((entry) => entry.id) : []).toEqual(["a", "b"]);
  });
});
