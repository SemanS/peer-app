import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { CliError, render } from "../../core/plugin.ts";
import { roomHubOf, roomPeer } from "./fixtures.test.ts";

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

type Fixture = Effect.Success<Effect.Success<ReturnType<typeof roomPeer>>["brokered"]>;

const peerRoom = (fixture: Fixture, session: string) =>
  Effect.promise(async () => {
    await fixture.register(session);
    return fixture.broker["runCli"]("room", [], {
      "x-peer-cwd": fixture.root,
      "x-peer-session": `claude:${session}`,
    }).then(
      (printed) => printed,
      (error: unknown) => (error instanceof CliError ? render(error) : String(error)),
    );
  });

describe("peer room through the broker", () => {
  it.effect("refuses a session on no task, and lists the tools", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* roomPeer(roomHubOf());
        const fixture = yield* peer.brokered;
        assert.match(
          yield* peerRoom(fixture, "one"),
          /^peer: usage: This session is on no task, so it has no room\./,
        );
        const { tools } = yield* peer.agents.tools;
        assert.includeMembers(
          tools.map((tool) => tool.name),
          ["peer_room_read", "peer_room_say"],
        );
      }),
    ),
  );

  it.effect("is not a command while the plugin is off", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* roomPeer(roomHubOf());
        yield* peer.plugins.setPlugin({ id: "rooms", enabled: false });
        const fixture = yield* peer.brokered;
        assert.strictEqual(
          yield* peerRoom(fixture, "one"),
          "peer: refused: room is turned off on this environment.\nNext: ask your person to enable the plugin or update the Peer Hub, then retry.",
        );
      }),
    ),
  );
});
