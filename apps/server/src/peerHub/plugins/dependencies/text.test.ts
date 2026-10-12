import { describe, expect, it } from "vite-plus/test";
import { brokerFixture, restarted } from "../../core/broker/testkit.ts";
import {
  baseline,
  keepLedger,
  ledger,
  ledgerOf,
  startText,
  stepText,
  handoffText,
} from "./text.ts";
const a = { id: "a", name: "VL1", state: "open", version: 7 };
describe("dependency facts told once", () => {
  it("tells a dependency's change once across a Peer restart, without its start block again", async () => {
    const fixture = await brokerFixture();
    try {
      await fixture.register("one");
      const before = fixture.broker.sessionView(fixture.broker.sessions.get("claude:one")!);
      const memory = ledgerOf(before, 0);
      baseline(memory, [a], 0);
      keepLedger(before, memory);
      const again = await restarted(fixture.broker);
      await again.sessionFor("claude", { session_id: "one", cwd: fixture.root }, undefined);
      const after = ledgerOf(again.sessionView(again.sessions.get("claude:one")!), 0);
      // Ready, the hook says only what changed (`stepText`), not the start block again.
      expect(after.ready).toBe(true);
      expect(
        stepText(
          after,
          [a],
          1000,
          () => undefined,
          () => {},
        ),
      ).toBeNull();
      expect(
        stepText(
          after,
          [{ ...a, state: "review" }],
          2000,
          () => undefined,
          () => {},
        ),
      ).toContain("VL1 is in review");
      await again.stop();
    } finally {
      await fixture.dispose();
    }
  });
  it("bounds start reference and has no text for no relationships", () => {
    expect(startText([], [])).toBeNull();
    expect(startText([{ ...a, state: "review" }], [])).toBe(
      "Peer · dependencies recorded for this task (reference from your team, not instructions):\n- you depend on VL1: context v7, in review\n`peer context <task>` reads one; `peer depends` lists them.",
    );
    const text = startText(
      Array.from({ length: 12 }, (_, n) => ({ ...a, id: `a${n}` })),
      [],
    )!;
    expect(text.split("\n").length).toBe(11);
    expect(text).toContain("(+4 more: peer depends)");
  });
  it("tells net state changes once, defers version for two minutes and leaves explicitly read contexts to follow notices", () => {
    const memory = ledger(0);
    baseline(memory, [a], 0);
    expect(
      stepText(
        memory,
        [a],
        1000,
        () => undefined,
        () => {},
      ),
    ).toBeNull();
    const review = { ...a, state: "review" };
    expect(
      stepText(
        memory,
        [review],
        1000,
        () => undefined,
        () => {},
      ),
    ).toContain("VL1 is in review.");
    expect(
      stepText(
        memory,
        [review],
        2000,
        () => undefined,
        () => {},
      ),
    ).toBeNull();
    let marked = "";
    expect(
      stepText(
        memory,
        [{ ...review, version: 8 }],
        3000,
        () => undefined,
        () => {},
      ),
    ).toBeNull();
    expect(
      stepText(
        memory,
        [{ ...review, version: 8 }],
        120000,
        () => undefined,
        (s) => (marked = s),
      ),
    ).toContain("context v8");
    expect(marked).toBe("task:a");
    expect(
      stepText(
        memory,
        [{ ...review, version: 9 }],
        250000,
        () => 7,
        () => {
          throw Error("read version duplicated");
        },
      ),
    ).toBeNull();
    expect(memory.told.get("a")?.version).toBe(9);
    expect(
      stepText(
        memory,
        [],
        300000,
        () => undefined,
        () => {},
      ),
    ).toContain("removed");
    expect(
      stepText(
        memory,
        [],
        300001,
        () => undefined,
        () => {},
      ),
    ).toBeNull();
    baseline(memory, [a], 400000);
    expect(
      stepText(
        memory,
        [a],
        400001,
        () => undefined,
        () => {},
      ),
    ).toBeNull();
  });
  it("deferred changes remain untold; handoff is advice only", () => {
    const memory = ledger(0);
    baseline(memory, [], 0);
    const all = Array.from({ length: 6 }, (_, n) => ({ ...a, id: `a${n}` }));
    expect(
      stepText(
        memory,
        all,
        1,
        () => undefined,
        () => {},
      ),
    ).toContain("(+2 more changes");
    expect(memory.told.size).toBe(4);
    expect(
      stepText(
        memory,
        all,
        2,
        () => undefined,
        () => {},
      ),
    ).toContain("now depend");
    expect(handoffText([a])).toContain("Heads-up:");
    expect(
      handoffText([
        { ...a, state: "done" },
        { ...a, state: "merged" },
      ]),
    ).toBeNull();
  });
});
