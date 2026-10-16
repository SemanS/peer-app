import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { AuditRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as RpcTest from "effect/rpc/RpcTest";
import * as PeerHub from "../../PeerHub.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import type { PeerRpcWrap } from "../../core/plugin.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import {
  coreLayer,
  coreRpcStandIns,
  seedState,
  signedInSeed,
  standInHub,
} from "../../core/testkit.ts";
import { AuditPlugin } from "./index.ts";

const wrap: PeerRpcWrap = {
  effect: (_method, effect) => effect,
  stream: (_method, stream) => stream,
};
describe("Audit through core", () => {
  it.effect("pages and filters explicitly, reports older Hubs, and refuses while disabled", () =>
    Effect.gen(function* () {
      let missing = false;
      const hub = yield* standInHub({
        current: (path) =>
          path.startsWith("/v1/workspaces/acme/audit?")
            ? missing
              ? [404, {}]
              : [
                  200,
                  {
                    entries: [
                      {
                        seq: 21,
                        at: "2026-10-09",
                        kind: "future.action",
                        actor: { type: "hub" },
                        subject: null,
                        project: null,
                        details: {},
                      },
                    ],
                    next: 21,
                  },
                ]
            : [200, {}],
      });
      const core = yield* Layer.build(
        coreLayer(yield* seedState(signedInSeed(hub.url)), {
          session: "s",
          plugins: [AuditPlugin],
        }),
      );
      const plugins = yield* Effect.gen(function* () {
        yield* (yield* PeerStatus.PeerStatus).coordinationFrom(() =>
          Effect.succeed({
            enabled: false,
            policy: "coordinate",
            claudeHooks: false,
            logPath: "/tmp/audit-test",
            sessions: [],
            overlaps: [],
            findings: [],
            contexts: [],
            candidates: [],
          }),
        );
        yield* PeerPlugins.startPlugins;
        return yield* PeerPlugins.PeerPlugins;
      }).pipe(Effect.provide(core));
      const built = yield* plugins.built;
      assert.isUndefined(built[0]?.contributions.commands);
      assert.isUndefined(built[0]?.contributions.hooks);
      assert.isUndefined(built[0]?.contributions.hubChanges);
      const client = yield* RpcTest.makeClient(AuditRpcGroup).pipe(
        Effect.provide(
          PeerHub.rpcLayer(wrap).pipe(
            Layer.provide(
              Layer.mergeAll(coreRpcStandIns, Layer.succeed(PeerPlugins.PeerPlugins, plugins)),
            ),
          ),
        ),
      );
      const first = yield* client["peer.audit.list"]({
        workspace: "acme",
        kinds: ["member", "key"],
        member: "ana@acme.test",
        limit: 10,
      });
      assert.strictEqual(first.next, 21);
      const second = yield* client["peer.audit.list"]({ workspace: "acme", before: first.next! });
      assert.strictEqual(second.entries[0]?.kind, "future.action");
      assert.isTrue(
        hub.calls.some((c) =>
          c.url?.includes("kind=member&kind=key&member=ana%40acme.test&limit=10"),
        ),
      );
      assert.isTrue(hub.calls.some((c) => c.url?.includes("before=21")));
      missing = true;
      assert.isTrue((yield* client["peer.audit.list"]({ workspace: "acme" })).unsupported);
      yield* plugins.setPlugin({ id: "audit", enabled: false });
      const count = hub.calls.length;
      const refused = yield* client["peer.audit.list"]({ workspace: "acme" }).pipe(Effect.result);
      assert.isTrue(Result.isFailure(refused));
      assert.strictEqual(hub.calls.length, count);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
