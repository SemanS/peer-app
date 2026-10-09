import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { digestGet } from "./rpc.ts";
it.effect("checks project membership before any fetch and propagates unsupported Hub", () =>
  Effect.gen(function* () {
    let called = 0;
    const get = digestGet(
      (w, p) => w === "acme" && p === "app",
      () => {
        called++;
        return Effect.succeed(null);
      },
    );
    expect(
      yield* get({ workspace: "acme", project: "unknown", since: "8h" }).pipe(Effect.flip),
    ).toMatchObject({ _tag: "PeerHubError" });
    expect(called).toBe(0);
    expect(yield* get({ workspace: "acme", project: "app", since: "8h" })).toBeNull();
    expect(called).toBe(1);
  }),
);
