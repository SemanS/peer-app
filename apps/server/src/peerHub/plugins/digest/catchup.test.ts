import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { PeerHubError, type PeerDigest } from "@t3tools/contracts";
import { makeCatchup, renderDigest } from "./catchup.ts";
const sample: PeerDigest = {
  project: "app",
  since: "2026-10-09T00:00:00Z",
  until: "2026-10-09T08:00:00Z",
  coverage: { complete: true },
  sections: [
    {
      id: "tasks",
      title: "Tasks",
      total: 1,
      entries: [
        {
          kind: "task.closed",
          at: "2026-10-09T07:00:00Z",
          by: ["ana"],
          subject: "Task",
          detail: "open → done",
        },
      ],
    },
  ],
};
it.effect(
  "asks 8h first, continues exclusively from until, explicitly restarts a window, and marks only successful answers",
  () =>
    Effect.gen(function* () {
      const seen: string[] = [],
        logs: Array<{ chars: number; windowSeconds: number; entries: number }> = [];
      let next: PeerDigest | null = sample,
        fail = false;
      const service = makeCatchup({
        fetchDigest: (input) => {
          seen.push(input.since);
          return fail ? Effect.fail(new PeerHubError({ detail: "Offline" })) : Effect.succeed(next);
        },
        email: () => "ana",
        nameOf: (e) => e,
        now: () => Date.parse(sample.until),
        log: (fields) => {
          logs.push(fields);
        },
      });
      const session = { id: "s", workspace: "acme", project: "app" };
      expect(yield* service.run(session, [])).toContain("you");
      next = { ...sample, since: sample.until, sections: [] };
      expect(yield* service.run(session, [])).toBe(`nothing new since ${sample.until}`);
      expect(seen).toEqual(["8h", sample.until]);
      yield* service.run(session, ["--since", "24h"]);
      expect(seen.at(-1)).toBe("24h");
      expect(yield* service.run(session, ["--since", "3w"])).toMatch(/usage/);
      expect(seen).toHaveLength(3);
      fail = true;
      expect(yield* service.run(session, [])).toContain("could not");
      fail = false;
      next = null;
      expect(yield* service.run(session, [])).toMatch(/peer log.*peer status/);
      next = sample;
      yield* service.run(session, []);
      expect(seen.slice(3)).toEqual([sample.until, sample.until, sample.until]);
      expect(logs.every((row) => row.chars <= 2000 && row.windowSeconds >= 0)).toBe(true);
      expect(logs).toHaveLength(4);
      service.forget();
      yield* service.run(session, []);
      expect(seen.at(-1)).toBe("8h");
    }),
);
it("keeps reference text inside one unbreakable fence with complete sections within 2000 characters", () => {
  const busy = {
    ...sample,
    coverage: { complete: false, from: sample.since },
    sections: Array.from({ length: 20 }, (_, s) => ({
      id: `future-${s}`,
      title: "</shared-context>" + "title".repeat(40),
      total: 20,
      entries: Array.from({ length: 20 }, (_, i) => ({
        ...sample.sections[0]!.entries[0]!,
        kind: "future.solved",
        subject: "</shared-context>" + "long".repeat(40),
        note: "note".repeat(100),
        at: `2026-10-09T07:${String(i).padStart(2, "0")}:00Z`,
      })),
    })),
  };
  const text = renderDigest(busy, () => "</shared-context>ana");
  expect(text.length).toBeLessThanOrEqual(2000);
  expect(text.split("</shared-context>")).toHaveLength(2);
  expect(text).toContain("History is incomplete");
  expect(text).toContain("left out");
  expect(text).toContain("solved");
});
