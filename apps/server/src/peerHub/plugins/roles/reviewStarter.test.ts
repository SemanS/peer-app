import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";

import { bindPlugin, type PeerTaskLauncher } from "../../core/plugin.ts";
import { acmeHub, acmeHubOf, rolesPeer, rolesWhen } from "./fixtures.test.ts";
import { RolesPlugin } from "./index.ts";

type Launch = Parameters<PeerTaskLauncher["launch"]>[0];

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const herdrOf = (launched: Launch[]) =>
  bindPlugin({
    id: "herdr",
    title: "herdr",
    summary: "test",
    defaultEnabled: true,
    layer: Layer.empty,
    make: Effect.succeed({
      taskLauncher: {
        unavailable: Effect.succeed(null),
        launch: (asked) =>
          Effect.sync(() => {
            launched.push(asked);
            return { paneId: "pane-9", terminalId: "term-9", threadKey: "herdr:term-9" };
          }),
      },
    }),
  });

const start = {
  workspace: "acme",
  projectId: "app",
  taskId: "vl-7",
  repositoryId: "api",
  harness: "claude" as const,
};

/** Peer as Bob with roles and a stand-in launcher, its Hub's roles read once. */
const peerWith = (launched: Launch[]) =>
  Effect.gen(function* () {
    const current = {
      ...acmeHubOf(),
      route: (method: string, url: string) =>
        method === "POST" && url.includes("/runs") ? ([200, { ok: true }] as const) : undefined,
    };
    const server = yield* acmeHub(current);
    const peer = yield* rolesPeer(server, [herdrOf(launched), RolesPlugin]);
    yield* rolesWhen(peer.status, (roles) => (roles?.projects.length ?? 0) > 0);
    return peer;
  });

describe("the reviewStarter slot", () => {
  it.effect("starts a review session with the plugin's prompt in place of the review prompt", () =>
    run(
      Effect.gen(function* () {
        const launched: Launch[] = [];
        const peer = yield* peerWith(launched);
        const starter = yield* peer.plugins.require("reviewStarter");
        const started = yield* starter.start({ ...start, prompt: "Answer the room." });
        assert.strictEqual(launched[0]?.prompt, "Answer the room.");
        assert.strictEqual(started.thread, "herdr:term-9");
        assert.isString(started.run);
        assert.strictEqual(launched[0]?.env.PEER_RUN, started.run);
        const roles = (yield* peer.status.publish).roles;
        assert.deepStrictEqual(
          roles?.threads.map(({ thread, role }) => ({ thread, role })),
          [{ thread: "herdr:term-9", role: "review" }],
        );
      }),
    ),
  );

  it.effect("a herdr session that knows no thread takes the role from the run it joined", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* peerWith([]);
        const started = yield* (yield* peer.plugins.require("reviewStarter")).start(start);
        const built = yield* peer.plugins.built;
        const refusal = built.find(({ state }) => state.id === "roles")?.contributions.beforeReview;
        const session = {
          workspace: "acme",
          project: "app",
          thread: undefined,
          local: <A>(_: string, make: () => A) => make(),
        };
        const inRun = yield* refusal!({ session: { ...session, run: started.run } } as never);
        const elsewhere = yield* refusal!({ session: { ...session, run: "run_other" } } as never);
        assert.isNotNull(inRun);
        assert.isNull(elsewhere);
      }),
    ),
  );

  it.effect("says which runs of a project are reviews", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* peerWith([]);
        const starter = yield* peer.plugins.require("reviewStarter");
        const started = yield* starter.start(start);
        const runs = yield* starter.reviewRuns("acme", "app");
        assert.isTrue(started.run !== undefined && runs.has(started.run));
        assert.strictEqual((yield* starter.reviewRuns("acme", "other")).size, 0);
      }),
    ),
  );

  it.effect("keeps the review prompt when the plugin gives none", () =>
    run(
      Effect.gen(function* () {
        const launched: Launch[] = [];
        const peer = yield* peerWith(launched);
        yield* (yield* peer.plugins.require("reviewStarter")).start(start);
        assert.match(launched[0]?.prompt ?? "", /^Review VL-7: Order totals\./);
      }),
    ),
  );

  it.effect("fails saying the plugin is off, and nothing starts", () =>
    run(
      Effect.gen(function* () {
        const launched: Launch[] = [];
        const peer = yield* peerWith(launched);
        yield* peer.plugins.setPlugin({ id: "roles", enabled: false });
        const refused = yield* peer.plugins.require("reviewStarter").pipe(Effect.result);
        assert.isTrue(Result.isFailure(refused));
        if (Result.isFailure(refused))
          assert.strictEqual(
            refused.failure.detail,
            "Review sessions is turned off on this environment.",
          );
        assert.deepStrictEqual(launched, []);
      }),
    ),
  );

  it.effect("fails saying the Hub is too old where it does not serve roles", () =>
    run(
      Effect.gen(function* () {
        const server = yield* acmeHub({ ...acmeHubOf(), features: {} });
        const peer = yield* rolesPeer(server);
        const refused = yield* peer.plugins.require("reviewStarter").pipe(Effect.result);
        assert.isTrue(Result.isFailure(refused));
        if (Result.isFailure(refused))
          assert.strictEqual(refused.failure.detail, "Review sessions needs a newer Peer Hub.");
      }),
    ),
  );
});
