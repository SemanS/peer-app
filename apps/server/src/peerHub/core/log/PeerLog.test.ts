import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as ServerConfig from "../../../config.ts";
import { seedState } from "../testkit.ts";
import * as PeerLog from "./PeerLog.ts";
it.effect("one service instance exposes the same ordered writer queue to every reader", () =>
  Effect.gen(function* () {
    const base = yield* seedState();
    const logLayer = PeerLog.layer.pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), base)));
    const context = yield* Layer.build(logLayer);
    yield* Effect.gen(function* () {
      const a = yield* PeerLog.PeerLog,
        b = yield* PeerLog.PeerLog;
      assert.strictEqual(a, b);
      a.record("hook", { chars: 10 });
      b.record("hook", { chars: 20 });
      yield* Effect.promise(b.idle);
      const text = yield* (yield* FileSystem.FileSystem).readFileString(a.path);
      assert.isTrue(text.indexOf('"chars":10') < text.indexOf('"chars":20'));
    }).pipe(Effect.provide(context));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
