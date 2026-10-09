import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { GitHubRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as RpcTest from "effect/unstable/rpc/RpcTest";
import * as PeerHub from "../../PeerHub.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import type { PeerRpcWrap } from "../../core/plugin.ts";
import {
  coreLayer,
  coreRpcStandIns,
  paymentsSeed,
  seedState,
  standInHub,
} from "../../core/testkit.ts";
import { GitHubPlugin } from "./index.ts";
import { GitHubCli } from "./client/gh.ts";
const wrap: PeerRpcWrap = { effect: (_, effect) => effect, stream: (_, stream) => stream };
describe("GitHub delivery plugin", () => {
  it.effect("registers delivery without waking, guards RPC while off and restores it", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub({ current: () => [404, {}] });
      const core = yield* Layer.build(
        coreLayer(yield* seedState(paymentsSeed(hub.url)), {
          session: "s",
          plugins: [GitHubPlugin],
        }),
      );
      const plugins = yield* Effect.gen(function* () {
        yield* (yield* PeerStatus.PeerStatus).coordinationFrom(() =>
          Effect.succeed({
            enabled: false,
            policy: "coordinate",
            claudeHooks: false,
            logPath: "",
            sessions: [],
            overlaps: [],
            findings: [],
            contexts: [],
            candidates: [],
          }),
        );
        yield* PeerPlugins.startPlugins.pipe(
          Effect.provideService(GitHubCli, {
            find: Effect.succeed(null),
            run: async () => "",
            signIn: () => Promise.reject(new Error("unused")),
          }),
        );
        return yield* PeerPlugins.PeerPlugins;
      }).pipe(Effect.provide(core));
      const contributions = (yield* plugins.built)[0]?.contributions;
      assert.strictEqual(contributions?.commands?.[0]?.name, "delivery");
      assert.strictEqual(contributions?.hooks?.notices?.[0]?.wakes, false);
      const client = yield* RpcTest.makeClient(GitHubRpcGroup).pipe(
        Effect.provide(
          PeerHub.rpcLayer(wrap).pipe(
            Layer.provide(
              Layer.mergeAll(coreRpcStandIns, Layer.succeed(PeerPlugins.PeerPlugins, plugins)),
            ),
          ),
        ),
      );
      assert.isTrue((yield* client["peerGitHub.status"]({ workspace: "acme" })).unsupported);
      yield* plugins.setPlugin({ id: "github", enabled: false });
      const count = hub.calls.length;
      assert.isTrue(
        Result.isFailure(
          yield* client["peerGitHub.status"]({ workspace: "acme" }).pipe(Effect.result),
        ),
      );
      assert.strictEqual(hub.calls.length, count);
      yield* plugins.setPlugin({ id: "github", enabled: true });
      assert.isTrue((yield* client["peerGitHub.status"]({ workspace: "acme" })).unsupported);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
