import { assert, describe, it } from "@effect/vitest";

import { boundHerdrObservations, herdrStatusPaths, HerdrCompletionTracker } from "./follower.ts";

describe("herdr completion observations", () => {
  it("keeps every live enforcement session and shows how many observations could not fit", () => {
    const primary = Array.from({ length: 49 }, (_, index) => `hook-${index}`);
    assert.deepStrictEqual(boundHerdrObservations(primary, ["observed-1", "observed-2"]), {
      sessions: [...primary, "observed-1"],
      skipped: 1,
    });
    const full = [...primary, "hook-49"];
    assert.deepStrictEqual(boundHerdrObservations(full, ["observed-1"]), {
      sessions: full,
      skipped: 1,
    });
    assert.deepStrictEqual(
      boundHerdrObservations([...full, "hook-50"], ["observed-1"]),
      { sessions: [...full, "hook-50"], skipped: 1 },
      "An existing enforcement session is never silently discarded to fit observations",
    );
  });
  it("detects each completed turn once, including one wholly between polls, and separates conversations", () => {
    const tracker = new HerdrCompletionTracker();
    const agent = {
      terminalId: "t1",
      paneId: "p1",
      agent: "claude",
      title: "agent",
      status: "idle" as const,
      completionSeq: undefined,
      cwd: "/work",
      session: { id: "s1", path: undefined },
    };
    assert.strictEqual(tracker.completed(agent), false, "startup idle is not completed work");
    assert.strictEqual(tracker.completed({ ...agent, completionSeq: 10 }), true);
    assert.strictEqual(tracker.completed({ ...agent, completionSeq: 10 }), false);
    assert.strictEqual(tracker.completed({ ...agent, completionSeq: 11 }), true);
    assert.strictEqual(tracker.completed({ ...agent, status: "working" }), false);
    assert.strictEqual(tracker.completed(agent), true, "old servers need an observed working edge");
    assert.strictEqual(
      tracker.completed({ ...agent, session: { id: "s2", path: undefined } }),
      false,
      "a switched conversation starts a new observation",
    );
  });

  it("preserves spaces, newlines and both sides of renames without shell parsing", () => {
    assert.deepStrictEqual(
      herdrStatusPaths(" M src/a b.ts\0R  new\nname.ts\0old name.ts\0?? $(private).txt\0"),
      ["$(private).txt", "new\nname.ts", "old name.ts", "src/a b.ts"],
    );
  });
});
