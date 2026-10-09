import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { type PeerHubStatus, type PeerStaleReads } from "@t3tools/contracts";
import { AgentAwarenessRelay } from "../../../relay/AgentAwarenessRelay.ts";
import { layerTest } from "../../../config.ts";
import { PeerAgents } from "../../core/coordination/PeerAgents.ts";
import { PeerStatus } from "../../core/status/PeerStatus.ts";
import { seedState } from "../../core/testkit.ts";
import type { PeerSessionView } from "../../core/plugin.ts";
import { make, NeedsYou } from "./service.ts";
import { richStatus, SINCE } from "./testkit.ts";

describe("Needs You standing-refusal worker", () => {
  it.effect(
    "rechecks at the two-minute boundary and clears a recovered input at the next deadline",
    () =>
      Effect.gen(function* () {
        let stale: PeerStaleReads["stale"] = [
          {
            project: "app",
            scope: "task:removed",
            readVersion: 3,
            currentVersion: null,
            at: SINCE,
            updatedAt: null,
          },
        ];
        let checks = 0,
          service: NeedsYou["Service"];
        const observations = yield* Queue.unbounded<{ status: PeerHubStatus; checks: number }>();
        const fixture = richStatus();
        const published = Effect.suspend(() =>
          service.read.pipe(
            Effect.flatMap((needsYou) => {
              const value = { ...fixture, needsYou };
              return Queue.offer(observations, { status: value, checks }).pipe(Effect.as(value));
            }),
          ),
        );
        service = yield* make.pipe(
          Effect.provide(
            Layer.mergeAll(
              layerTest(process.cwd(), yield* seedState()),
              Layer.mock(PeerStatus)({ publish: published, changes: Stream.make(fixture) }),
              Layer.mock(PeerAgents)({
                inPane: () => undefined,
                level: () => "C",
                sessions: Effect.succeed([{ id: "claude:s" } as PeerSessionView]),
                staleReads: () =>
                  Effect.sync(() => {
                    checks++;
                    return { fresh: stale.length === 0, stale };
                  }),
              }),
              Layer.mock(AgentAwarenessRelay)({
                publishingState: Effect.succeed("enabled"),
                externalCatchUp: () => Effect.void,
                publishExternal: () => Effect.void,
              }),
            ),
          ),
        );
        yield* service.run.pipe(Effect.forkScoped);
        yield* Queue.take(observations);
        yield* service.refuse("claude:s", stale);
        yield* Queue.take(observations);
        yield* TestClock.adjust("119 seconds");
        expect((yield* service.read).staleInputs).toEqual([]);
        expect(checks).toBe(0);
        yield* TestClock.adjust("1 second");
        const first = yield* Queue.take(observations);
        expect(first.checks).toBe(1);
        expect(first.status.needsYou?.staleInputs[0]?.scopes[0]?.currentVersion).toBeNull();
        stale = [];
        yield* TestClock.adjust("2 minutes");
        const recovered = yield* Queue.take(observations);
        expect(recovered.checks).toBe(2);
        expect(recovered.status.needsYou?.staleInputs).toEqual([]);
        yield* TestClock.adjust("1 day");
        expect(checks).toBe(2);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
