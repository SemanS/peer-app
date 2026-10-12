import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { PeerForecast } from "@t3tools/contracts";
import type { PeerSessionView } from "../../core/plugin.ts";
import type { PeerPluginId } from "@t3tools/contracts";
import { layer as agentsLayer } from "../../core/coordination/PeerAgents.ts";
import { brokerFixture } from "../../core/broker/testkit.ts";
import { NO_PLUGINS } from "../../core/broker/host.ts";
import { make, ForecastPlugin } from "./index.ts";
import { Forecast, type ForecastPair } from "./ForecastService.ts";
const snapshot: PeerForecast = {
  state: "on",
  teammates: false,
  pairs: [],
  tracked: 2,
  skipped: 0,
  notOnOrigin: 0,
  paused: [],
};
const subject = {
  workspace: "acme",
  project: "app",
  repository: "api",
  branch: "feature/a",
  email: "ana@test",
  title: "A",
  where: "here" as const,
  ref: "a",
  live: true,
  at: 0,
};
const pair: ForecastPair = {
  key: "pair",
  repository: "repo",
  a: "a",
  b: "b",
  refs: ["a", "b"],
  left: subject,
  right: { ...subject, branch: "feature/b", email: "bob@test" },
  git: { common: "repo", objects: "repo/objects" },
  result: { state: "conflict", files: ["pay.ts"], more: 0 },
  checkedAt: 0,
};
const contributions = () =>
  Effect.gen(function* () {
    let reads = 0;
    const service = Forecast.of({
      read: Effect.succeed(snapshot),
      boot: Effect.void,
      stop: Effect.void,
      forget: () => Effect.void,
      run: Effect.never,
      round: () => Effect.void,
      kick: Effect.void,
      pairs: Effect.succeed([pair]),
      forSession: () => [pair],
      refresh: () =>
        Effect.sync(() => {
          reads++;
          return snapshot;
        }),
      configure: () => Effect.succeed(snapshot),
      changes: Stream.make(snapshot),
    });
    const contributions = yield* make.pipe(
      Effect.provideService(Forecast, service),
      Effect.provide(agentsLayer),
      Effect.scoped,
    );
    return { contributions, reads: () => reads };
  });
describe("forecast plugin transports", () => {
  it.effect(
    "offers Claude and Codex one in-memory notice at a step, never through wakes or MCP",
    () =>
      Effect.gen(function* () {
        const { contributions: c, reads } = yield* contributions(),
          fixture = yield* Effect.promise(() => brokerFixture());
        try {
          yield* Effect.promise(() => fixture.register("one"));
          const native = fixture.broker.sessionViews()[0]!;
          const local = new Map<PeerPluginId, unknown>();
          const told = new Map<PeerPluginId, Set<string>>();
          const codex: PeerSessionView = {
            ...native,
            id: "codex:two",
            agent: "codex",
            local: <S>(id: PeerPluginId, init: () => S) => {
              if (!local.has(id)) local.set(id, init());
              return local.get(id) as S;
            },
            told: (id: PeerPluginId) => {
              const ids = told.get(id) ?? new Set<string>();
              told.set(id, ids);
              return ids;
            },
          };
          for (const session of [native, codex]) {
            const ctx = { session, event: "prompt" as const, remainingMs: 1200 };
            const read = c.hooks!.notices![0]!.read;
            expect(yield* read(ctx)).toContain("Predicted");
            expect(yield* read(ctx)).toBeNull();
            yield* c.hooks!.sessionStart!(ctx);
            expect(yield* read({ ...ctx, waking: true })).toBeNull();
            expect(yield* read({ ...ctx, session: { ...session, adapter: "mcp" } })).toBeNull();
            expect(yield* read(ctx)).toContain("Predicted");
          }
          expect(reads()).toBe(0);
          expect(ForecastPlugin.hubFeature).toBeUndefined();
          expect(c).not.toHaveProperty("hubChanges");
        } finally {
          yield* Effect.promise(() => fixture.dispose());
        }
      }),
  );
  it.effect(
    "uses the normal CLI router, validates arguments and refuses a disabled feature without refreshing",
    () =>
      Effect.gen(function* () {
        const { contributions: c, reads } = yield* contributions(),
          command = c.commands![0]!;
        let off = false;
        const fixture = yield* Effect.promise(() =>
          brokerFixture(() => ({
            branchOf: async () => "feature/a",
            plugins: async () => ({
              ...NO_PLUGINS,
              commands: [
                { plugin: "forecast", command, ...(off ? { refused: "off" as const } : {}) },
              ],
            }),
          })),
        );
        try {
          yield* Effect.promise(() => fixture.register("one"));
          const headers = { "x-peer-session": "claude:one", "x-peer-cwd": fixture.root };
          expect(
            yield* Effect.promise(() => fixture.broker.runCli("forecast", [], headers)),
          ).toContain("pay.ts");
          expect(reads()).toBe(1);
          yield* Effect.promise(() =>
            expect(fixture.broker.runCli("forecast", ["extra"], headers)).rejects.toMatchObject({
              outcome: "usage",
            }),
          );
          expect(reads()).toBe(1);
          off = true;
          expect(yield* Effect.promise(() => fixture.broker.runCli("help", [], {}))).not.toContain(
            "peer forecast",
          );
          yield* Effect.promise(() =>
            expect(fixture.broker.runCli("forecast", [], headers)).rejects.toMatchObject({
              outcome: "refused",
            }),
          );
          expect(reads()).toBe(1);
        } finally {
          yield* Effect.promise(() => fixture.dispose());
        }
      }),
  );
});
