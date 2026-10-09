import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { CoordinationBroker } from "../broker/Broker.ts";
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

it.effect(
  "prompts only a live local runtime with matching pane and current coordinated session",
  () =>
    Effect.gen(function* () {
      const agents = yield* PeerAgents.PeerAgents;
      const asked: string[] = [];
      let present = true,
        level: "A" | "B" | "C" = "B";
      const broker = {
        onViewChange: () => () => undefined,
        localRuntimeAgents: async () =>
          present
            ? [{ id: "herdr:claude:one", paneId: "p", status: "running", title: "Mine" }]
            : [],
        sessionViews: () => [{ id: "claude:one", pane: "p" }],
        coordinationLevel: () => level,
        plugins: async () => ({
          runtime: {
            prefix: "herdr:",
            prompt: (id: string, text: string) =>
              Effect.sync(() => void asked.push(`${id}:${text}`)),
          },
        }),
        host: { run: Effect.runPromise },
      } as unknown as CoordinationBroker;
      yield* agents.attach(broker);
      yield* agents.promptRuntime("herdr:claude:one", "words");
      assert.deepStrictEqual(asked, ["herdr:claude:one:words"]);
      present = false;
      assert.strictEqual(
        (yield* agents.promptRuntime("herdr:claude:one", "words").pipe(Effect.flip))._tag,
        "PeerHubError",
      );
      present = true;
      level = "C";
      yield* agents.promptRuntime("herdr:claude:one", "words").pipe(Effect.flip);
      assert.strictEqual(asked.length, 1);
      yield* agents.promptRuntime("herdr:colleague", "words").pipe(Effect.flip);
      assert.strictEqual(asked.length, 1);
    }).pipe(Effect.provide(PeerAgents.layer)),
);
