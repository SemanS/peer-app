import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { CoordinationBroker } from "../../coordinationBroker.ts";
import * as PeerAgents from "./PeerAgents.ts";

/** A broker that only reports, writing down what it was asked and failing while `failing`. */
const reportingBroker = () => {
  const state = { reported: [] as Array<string>, failing: false };
  const broker = {
    onViewChange: () => () => undefined,
    reportNow: (workspace: string) => {
      state.reported.push(workspace);
      return state.failing ? Promise.reject(new Error("The broker stopped.")) : Promise.resolve();
    },
  } as unknown as CoordinationBroker;
  return { state, broker };
};

describe("PeerAgents.report", () => {
  it.effect("reports through the running broker, and does nothing while coordination is off", () =>
    Effect.gen(function* () {
      const agents = yield* PeerAgents.PeerAgents;
      const { state, broker } = reportingBroker();
      yield* agents.report("acme");
      assert.deepStrictEqual(state.reported, []);
      yield* agents.attach(broker);
      yield* agents.report("acme");
      assert.deepStrictEqual(state.reported, ["acme"]);
      yield* agents.attach(null);
      yield* agents.report("acme");
      assert.deepStrictEqual(state.reported, ["acme"]);
    }).pipe(Effect.provide(PeerAgents.layer)),
  );

  it.effect("fails with a typed error, not a defect, when the report could not run", () =>
    Effect.gen(function* () {
      const agents = yield* PeerAgents.PeerAgents;
      const { state, broker } = reportingBroker();
      state.failing = true;
      yield* agents.attach(broker);
      const failure = yield* agents.report("acme").pipe(Effect.flip);
      assert.strictEqual(failure._tag, "PeerHubError");
      assert.strictEqual(
        failure.detail,
        "This computer's sessions could not be reported to the Hub: The broker stopped.",
      );
    }).pipe(Effect.provide(PeerAgents.layer)),
  );
});
