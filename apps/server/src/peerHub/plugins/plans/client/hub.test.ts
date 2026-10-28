import { assert, it as effectIt } from "@effect/vitest";
import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type { PeerHubClient } from "../../../core/hub/PeerHubClient.ts";
import { challenge } from "../fixtures.test.ts";
import { LACKS_CHALLENGES, createOutbox, plansHub, type Declaration } from "./hub.ts";

const declaration = (path: string): Declaration => ({
  mode: "replace",
  items: { changes: [{ path }], maybes: [], uses: [], provides: [] },
});
const live = new Set(["agent"]);
const queued = (outbox: ReturnType<typeof createOutbox>, now: number, path: string) => {
  const prepared = outbox.prepare("agent", now, declaration(path));
  outbox.hold(
    "agent",
    { ...prepared.declaration, seq: prepared.seq, workspace: "acme", project: "app" },
    now,
  );
  return outbox.due(now + 10_000, live)[0]![1];
};

describe("plan declaration outbox", () => {
  it.each(["success", "failure"] as const)(
    "keeps a newer queued declaration when an older retry ends with %s",
    (outcome) => {
      const outbox = createOutbox();
      const old = queued(outbox, 1_000, "src/old.ts");
      const newer = queued(outbox, 11_001, "src/new.ts");
      if (outcome === "success") outbox.drop("agent", old.seq);
      else outbox.later("agent", old, 12_000);
      expect(outbox.due(30_000, live)).toEqual([["agent", newer]]);
    },
  );

  it("ignores a late foreground failure after a newer declaration was queued", () => {
    const outbox = createOutbox();
    const old = outbox.prepare("agent", 1_000, declaration("src/old.ts"));
    const newer = queued(outbox, 2_000, "src/new.ts");
    outbox.hold(
      "agent",
      { ...old.declaration, seq: old.seq, workspace: "acme", project: "app" },
      3_000,
    );
    expect(outbox.due(30_000, live)).toEqual([["agent", newer]]);
  });

  it("acknowledges an older queued declaration included in the latest amendment", () => {
    const outbox = createOutbox();
    queued(outbox, 1_000, "src/old.ts");
    const newer = outbox.prepare("agent", 2_000, { ...declaration("src/new.ts"), mode: "amend" });
    expect(newer.declaration.items.changes).toEqual([
      { path: "src/old.ts" },
      { path: "src/new.ts" },
    ]);
    outbox.drop("agent", newer.seq);
    expect(outbox.due(30_000, live)).toEqual([]);
  });
});

/** A Hub client whose catalog serves plans at `revision` and that answers every request with `answer`. */
const client = (revision: number, answer: unknown) => {
  const asked: Array<Record<string, unknown>> = [];
  const fake = {
    features: Effect.succeed({ plans: revision }),
    request: (_schema: unknown, input: Record<string, unknown>) => {
      asked.push(input);
      return Effect.succeed(answer);
    },
  } as unknown as PeerHubClient["Service"];
  return { hub: plansHub(fake), asked };
};
const ids = { environment: "bob-mac", session: "claude:b" };
const challenged = { challenge: challenge("ch-1"), hearing: 1, changed: true, at: "now" };

describe("challenges at the Hub", () => {
  effectIt.effect("records and closes them with one plain request each, on plans revision 2", () =>
    Effect.gen(function* () {
      const { hub, asked } = client(2, challenged);
      const recorded = yield* hub.challenge("acme", "pay app", {
        ...ids,
        item: { path: "src/a.ts" },
        reason: "why",
      });
      assert.deepStrictEqual(recorded, challenged);
      yield* hub.closeChallenge("acme", "pay app", { ...ids, close: "ch-1" });
      const path = "/plans/pay%20app/challenges";
      assert.deepStrictEqual(
        asked.map(({ path, method, body, workspace }) => ({ path, method, body, workspace })),
        [
          {
            workspace: "acme",
            path,
            method: "POST",
            body: { ...ids, item: { path: "src/a.ts" }, reason: "why" },
          },
          { workspace: "acme", path, method: "POST", body: { ...ids, close: "ch-1" } },
        ],
      );
      assert.isTrue(yield* hub.challengesServed);
    }),
  );

  effectIt.effect(
    "refuses them on a Hub whose plans are older than revision 2, and asks nothing",
    () =>
      Effect.gen(function* () {
        const { hub, asked } = client(1, challenged);
        const refused = yield* hub
          .closeChallenge("acme", "pay", { ...ids, close: "ch-1" })
          .pipe(Effect.result);
        assert.isTrue(Result.isFailure(refused) && refused.failure === LACKS_CHALLENGES);
        assert.strictEqual(
          LACKS_CHALLENGES.reason,
          "the Hub lacks plan challenges; nothing was recorded",
        );
        assert.deepStrictEqual(asked, []);
        assert.isFalse(yield* hub.challengesServed);
      }),
  );

  effectIt.effect("refuses them when the Hub has no route for challenges after all", () =>
    Effect.gen(function* () {
      const { hub } = client(2, null);
      const refused = yield* hub
        .challenge("acme", "pay", { ...ids, item: { path: "src/a.ts" }, reason: "why" })
        .pipe(Effect.result);
      assert.isTrue(Result.isFailure(refused) && refused.failure === LACKS_CHALLENGES);
    }),
  );
});
