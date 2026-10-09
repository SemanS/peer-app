import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { PeerContributions, PeerRuntimeProvider, ReportedSession } from "../plugin.ts";
import * as PeerPlugins from "../plugins/PeerPlugins.ts";
import { brokerPlugins } from "./PeerCoordination.ts";

const session = (id: string): ReportedSession => ({
  id,
  project: "app",
  label: id,
  status: "working",
  files: [],
  claims: [],
});

/** A plugin's contribution that adds one session to every report. */
const adding = (id: string, more: Partial<PeerContributions> = {}): PeerContributions => ({
  ...more,
  reportSessions: (_workspace, reported) => Effect.succeed([...reported, session(id)]),
});

describe("what plugins give the broker", () => {
  it.effect("adds the runtime's sessions to a report after every other plugin's", () =>
    Effect.gen(function* () {
      // herdr comes first in the registry and fits its observations within the Hub's bound.
      const given = yield* brokerPlugins.pipe(
        Effect.provide(
          Layer.mock(PeerPlugins.PeerPlugins)({
            active: Effect.succeed([
              {
                id: "herdr",
                title: "herdr",
                contributions: adding("observed", { runtime: {} as PeerRuntimeProvider }),
              },
              { id: "memory", title: "Peer Memory", contributions: adding("app-runtime") },
            ]),
            built: Effect.succeed([]),
            excluded: Effect.succeed([{ plugin: "ask", name: "ask", refused: "off" }]),
          }),
        ),
      );
      assert.deepStrictEqual(given.excluded, [{ plugin: "ask", name: "ask", refused: "off" }]);
      assert.deepStrictEqual(
        given.reportSessions.map(({ plugin }) => plugin),
        ["memory", "herdr"],
      );
      let reported: ReadonlyArray<ReportedSession> = [];
      for (const { add } of given.reportSessions) reported = yield* add("acme", reported);
      assert.deepStrictEqual(
        reported.map(({ id }) => id),
        ["app-runtime", "observed"],
      );
    }),
  );
});
