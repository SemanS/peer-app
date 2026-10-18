import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  bobOnAna,
  changesPeer,
  hooks,
  jjHome,
  peerChanges,
  scenarioRows,
  team,
  viewLoaded,
} from "./fixtures.test.ts";

const home = jjHome();

describe("peer changes and the start line", () => {
  it.live("print the spec's texts for Bob's agent", () =>
    Effect.gen(function* () {
      const t = team(home);
      const ids = bobOnAna(t);
      const { peer, fixture } = yield* changesPeer(
        { rows: scenarioRows(ids), features: { changes: 1 } },
        t.bob,
      );
      yield* viewLoaded(peer);
      const short = (id: string) => id.slice(0, 8);

      const start = yield* Effect.promise(() => hooks(fixture, t.bob).start());
      assert.include(
        start,
        `jj: you build on ORD-11 (${short(ids.ana)}, Ana · Claude Code), read-only to you. Also in flight: ORD-14, ORD-15. peer changes lists them.`,
      );

      const asked = yield* Effect.promise(() => peerChanges(fixture));
      assert.strictEqual(
        asked.replace(/checked \d\d:\d\d/, "checked 14:58"),
        [
          "Ordering demo · 4 changes in flight · checked 14:58",
          "",
          "<shared-context>",
          `- ${short(ids.bobChange)}  ORD-12  Loyalty points           Bob · Codex (you)    1 file   builds on ${short(ids.ana)}`,
          `- ${short(ids.ana)}  ORD-11  Receipt totals in cents  Ana · Claude Code    1 file   read-only to you`,
          "- smptwtuk  ORD-14  Totals include VAT       Eva · Claude Code    1 file   read-only to you",
          "- qpvuntsm  ORD-15  Refund reasons           Slavo · Claude Code  3 files  read-only to you",
          "</shared-context>",
          "",
          'Read one: jj show <id> · what moved under you: peer follow · ask: peer ask <task> "…"',
        ].join("\n"),
      );
      assert.isAtMost(asked.length, 1_500);
      assert.notInclude(asked, "conflicts with");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
