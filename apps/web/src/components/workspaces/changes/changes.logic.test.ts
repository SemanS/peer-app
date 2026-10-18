import { changeGraph } from "@t3tools/client-runtime/peer/changes";
import { describe, expect, it } from "vite-plus/test";

import {
  GRAPH,
  laneX,
  needAttentionOf,
  rewriteLine,
  rowDrawing,
  selectedId,
  versionsLine,
  whereLine,
} from "./changes.logic.ts";
import { changeId, row } from "./fixtures.test-util.ts";

describe("the navigation row's count", () => {
  const status = {
    changes: {
      hubSupport: "supported" as const,
      projects: [
        { workspace: "acme", project: "ordering", inFlight: 4, needAttention: 2 },
        { workspace: "acme", project: "billing", inFlight: 1, needAttention: 0 },
      ],
    },
  };

  it("counts the project's changes that hold a conflict or two versions", () => {
    expect(needAttentionOf(status, "acme", "ordering")).toBe(2);
  });

  it("is zero for a project the status does not list, and while the plugin is off", () => {
    expect(needAttentionOf(status, "acme", "missing")).toBe(0);
    expect(needAttentionOf({}, "acme", "ordering")).toBe(0);
  });
});

describe("who may rewrite a change", () => {
  const bob = row("mspqrmyv", { author: { email: "bob@acme.dev", agent: "codex" } });

  it("tells the author their own change is theirs and a terminal's", () => {
    expect(rewriteLine({ row: bob, mine: true })).toBe(
      "Only your Codex, which made it, and you in a terminal.",
    );
  });

  it("names the teammate's agent and says everyone else is read-only", () => {
    expect(rewriteLine({ row: bob, mine: false })).toContain("Only Bob's Codex, which made it");
    expect(rewriteLine({ row: bob, mine: false })).toContain("read-only");
  });

  it("says nobody for a landed change", () => {
    expect(rewriteLine({ row: undefined, mine: false })).toMatch(/^Nobody/);
  });
});

describe("the inspector's lines", () => {
  it("counts versions with the first time, the last move and the person's mark", () => {
    expect(
      versionsLine({ count: 6, since: "x", lastAgo: "1 min ago", marked: 5 }, () => "14:40"),
    ).toBe("6 versions since 14:40 · last 1 min ago · you marked version 5 reviewed");
    expect(
      versionsLine({ count: 1, since: undefined, lastAgo: undefined, marked: undefined }, () => ""),
    ).toBe("1 version");
  });

  it("says where a change lives", () => {
    expect(whereLine("Bob · Codex", [])).toBe("Bob · Codex");
    expect(whereLine("Bob · Codex", ["laptop", "desk"])).toBe("Bob · Codex, on laptop and desk");
  });
});

describe("the selection", () => {
  const graph = changeGraph({
    changes: [row("aaaaaaaa"), row("bbbbbbbb", { parents: [changeId("aaaaaaaa")] })],
  });

  it("keeps the person's pick while it is in the graph", () => {
    expect(selectedId(graph.rows, changeId("aaaaaaaa"))).toBe(changeId("aaaaaaaa"));
  });

  it("falls back to the first change when the pick left the graph", () => {
    expect(selectedId(graph.rows, "gone")).toBe(graph.rows[0]?.id);
    expect(selectedId([], undefined)).toBeUndefined();
  });
});

describe("the lanes of the canvas's scenario", () => {
  // Bob's change sits on Ana's in one lane; Eva's and Slavo's join main in a second.
  const changes = [
    row("lrorvllt", { versions: [{ commit: "a", at: "2026-10-18T14:31:00Z", kind: "edit" }] }),
    row("mspqrmyv", {
      parents: [changeId("lrorvllt")],
      versions: [{ commit: "b", at: "2026-10-18T14:40:00Z", kind: "edit" }],
    }),
    row("smptwtuk", { versions: [{ commit: "c", at: "2026-10-18T14:36:00Z", kind: "edit" }] }),
    row("qpvuntsm", { versions: [{ commit: "d", at: "2026-10-18T14:22:00Z", kind: "edit" }] }),
  ];
  const landed = {
    changeId: changeId("zsmtoopz"),
    commitId: "e".repeat(40),
    subject: "ORD-9",
    bookmark: "main@origin",
  };
  const graph = changeGraph({ changes, landed });

  it("draws every row inside one fixed-height cell, so rows meet", () => {
    for (const graphRow of graph.rows) {
      const drawing = rowDrawing(graphRow, graph.lanes);
      expect(drawing.node.y).toBe(GRAPH.node);
      expect(drawing.node.x).toBe(laneX(graphRow.lane));
      expect(drawing.width).toBe(GRAPH.margin * 2 + (graph.lanes - 1) * GRAPH.lane);
    }
  });

  it("gives the diamond of the landed row a line from above and none below", () => {
    const last = graph.rows.at(-1);
    expect(last?.kind).toBe("landed");
    if (last === undefined) return;
    const drawing = rowDrawing(last, graph.lanes);
    expect(drawing.lines.some((d) => d.startsWith(`M${laneX(last.lane)} 0V`))).toBe(true);
    expect(
      drawing.lines.some(
        (d) => d.includes(`V${GRAPH.row}`) && d.startsWith(`M${laneX(last.lane)} ${GRAPH.node}`),
      ),
    ).toBe(false);
  });

  it("curves a merging head into the lane that waits for its parent", () => {
    const joining = graph.rows.filter((r) => r.joins.length > 0);
    expect(joining.length).toBeGreaterThan(0);
    for (const graphRow of joining) {
      const lines = rowDrawing(graphRow, graph.lanes).lines;
      for (const join of graphRow.joins) {
        expect(
          lines.some((d) => d.endsWith(`${laneX(join.to)} ${GRAPH.row}`) && d.includes("C")),
        ).toBe(true);
      }
    }
  });
});
