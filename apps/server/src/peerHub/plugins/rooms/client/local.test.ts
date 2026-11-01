import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import type * as PeerState from "../../../core/state/PeerState.ts";
import { LOCAL_ROOM, localRoomsOf } from "./local.ts";

/** Peer's state as the store reads it: one value of the rooms plugin's data, in memory. */
const stateOf = () =>
  Effect.gen(function* () {
    const stored = yield* Ref.make<unknown>(Option.none());
    return {
      pluginData: () => ({
        read: Ref.get(stored),
        update: (next: (current: unknown) => unknown) =>
          Ref.update(stored, (current) => Option.some(next(current))),
      }),
      lock: {
        withPermits:
          () =>
          <A, E, R>(effect: Effect.Effect<A, E, R>) =>
            effect,
      },
    } as unknown as PeerState.PeerState["Service"];
  });

describe("a local room", () => {
  it.effect("keeps messages in order, by who wrote them, and posts one operation once", () =>
    Effect.gen(function* () {
      const local = localRoomsOf(yield* stateOf());
      const first = yield* local.post("app", { op: "a", text: "Start on totals" });
      const said = yield* local.post("app", {
        op: "b",
        text: "Done",
        run: "claude:one",
        agent: "claude",
        mark: "ready",
      });
      const repeated = yield* local.post("app", { op: "a", text: "Start on totals" });
      assert.strictEqual(repeated.seq, first.seq);
      assert.deepStrictEqual([first.seq, said.seq], [1, 2]);
      assert.deepStrictEqual(said.author, { email: "local", run: "claude:one", agent: "claude" });
      const read = yield* local.read("app", { after: 1 });
      assert.deepStrictEqual(
        read.messages.map((message) => message.text),
        ["Done"],
      );
    }),
  );

  it.effect("says of itself what a Hub's inbox says of its rooms", () =>
    Effect.gen(function* () {
      const local = localRoomsOf(yield* stateOf());
      yield* local.post("app", { op: "a", text: "Start" });
      yield* local.post("app", { op: "b", text: "Stuck", run: "codex:one", mark: "blocked" });
      yield* local.seen("app", 1);
      const inbox = yield* local.inbox;
      assert.deepStrictEqual(inbox.seqs, { app: { [LOCAL_ROOM]: 2 } });
      const room = inbox.rooms?.[0];
      assert.deepStrictEqual([room?.seq, room?.seen, room?.mark], [2, 1, "blocked"]);
    }),
  );

  it.effect("keeps the newest 200 messages, and forgets what posted the rest", () =>
    Effect.gen(function* () {
      const local = localRoomsOf(yield* stateOf());
      for (let seq = 1; seq <= 205; seq += 1)
        yield* local.post("app", { op: `op-${seq}`, text: `${seq}` });
      const read = yield* local.read("app", { limit: 500 });
      assert.strictEqual(read.messages.length, 200);
      assert.strictEqual(read.messages[0]?.text, "6");
      assert.strictEqual((yield* local.post("app", { op: "op-1", text: "again" })).seq, 206);
    }),
  );
});
