import { describe, expect, it } from "vite-plus/test";

import {
  flowIntro,
  flowTitle,
  isFlowEntry,
  trailHealth,
  trailHealthLine,
  trailStages,
} from "./flows.logic";

const TRAIL = [
  { stage: "Request", entry: "use-cache", text: "Settles that reads are cached." },
  { stage: "Request", entry: "cache-warms-late", text: "Bites on the first read." },
  { stage: "Answer", entry: "streamed", text: "Streams the answer." },
  { stage: "Answer", entry: "gone", text: "Was superseded." },
];

describe("flows.logic", () => {
  it("tells a flow from a module doc and reads its title", () => {
    expect(isFlowEntry({ id: "flow-read", kind: "architecture" })).toBe(true);
    expect(isFlowEntry({ id: "reads", kind: "architecture", tags: ["flow"] })).toBe(true);
    expect(isFlowEntry({ id: "mod-cache", kind: "architecture" })).toBe(false);
    expect(isFlowEntry({ id: "flow-read", kind: "decision" })).toBe(false);
    expect(flowTitle("Flow: a read, from the request to the cache")).toBe(
      "A read, from the request to the cache",
    );
    expect(flowTitle("Reads")).toBe("Reads");
    expect(flowIntro("A read passes\nthe cache.\n\n## Trail\n\n1. [[x]] — y")).toBe(
      "A read passes the cache.",
    );
  });

  it("groups consecutive steps into stages numbered along the whole trail", () => {
    const stages = trailStages(TRAIL);
    expect(stages.map((stage) => [stage.stage, stage.steps.map((step) => step.n)])).toEqual([
      ["Request", [1, 2]],
      ["Answer", [3, 4]],
    ]);
    expect(trailStages([{ stage: null, entry: "a", text: "" }])[0]?.stage).toBeNull();
  });

  it("counts a trail's health over the steps the page knows", () => {
    const health = trailHealth(TRAIL, (entry) =>
      entry === "use-cache" ? "verified" : entry === "gone" ? null : "needs-review",
    );
    expect(health).toEqual({ steps: 4, known: 3, verified: 1, review: 2 });
    expect(trailHealthLine(health)).toBe(
      "4 steps · 1 verified · 2 need review · 1 not in the saved knowledge",
    );
    expect(trailHealthLine({ steps: 1, known: 0, verified: 0, review: 0 })).toBe(
      "1 step · 1 not in the saved knowledge",
    );
  });
});
