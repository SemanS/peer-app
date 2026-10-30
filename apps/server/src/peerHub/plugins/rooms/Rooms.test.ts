// @effect-diagnostics preferSchemaOverJson:off - the bodies the Hub was sent.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { TEST_ENVIRONMENT, type HubCall } from "../../core/testkit.ts";
import { runCapacity } from "./client/start.ts";
import {
  ACME,
  BOB,
  EVA,
  contributionsOf,
  messageOf,
  NOW,
  roomHubOf,
  ROOM,
  roomPeer,
  roomsWhen,
} from "./fixtures.test.ts";
import { RoomsPlugin } from "./index.ts";

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const place = { workspace: "acme", project: "app", task: "vl-7" };

type Peer = Effect.Success<ReturnType<typeof roomPeer>>;

/** Calls the plugin's RPC handler for `method`, as the apps do. */
const rpc = (peer: Peer, method: string, input: unknown) =>
  Effect.gen(function* () {
    const { rpc: contributed } = yield* contributionsOf(peer);
    const handlers = contributed?.handlers({
      effect: (_, effect) => effect as never,
      stream: (_, stream) => stream as never,
    }) as Record<string, (input: unknown) => Effect.Effect<unknown, { readonly detail: string }>>;
    return yield* handlers[method]!(input);
  });

const bodyOf = (call: HubCall | undefined) => JSON.parse(call?.body ?? "{}") as unknown;
const callsTo = (peer: Peer, method: string, part: string) =>
  peer.server.calls.filter((call) => call.method === method && call.url?.includes(part));

describe("the rooms plugin", () => {
  it("is defined as its Settings row says", () => {
    assert.strictEqual(RoomsPlugin.id, "rooms");
    assert.isTrue(RoomsPlugin.defaultEnabled);
    assert.deepStrictEqual(RoomsPlugin.hubFeature, { id: "rooms", revision: 1 });
    assert.deepStrictEqual(RoomsPlugin.commandNames, ["room"]);
  });

  it.effect("is inactive where the Hub does not serve rooms, and refuses saying so", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* roomPeer(roomHubOf({ features: {} }));
        assert.isFalse(yield* peer.plugins.isActive("rooms"));
        const refused = yield* peer.plugins.requireActive("rooms").pipe(Effect.result);
        assert.isTrue(Result.isFailure(refused));
        if (Result.isFailure(refused))
          assert.strictEqual(refused.failure.detail, "Task rooms needs a newer Peer Hub.");
        assert.isUndefined((yield* peer.status.publish).rooms);
      }),
    ),
  );

  it.effect("turned off, leaves the status and forgets what it read", () =>
    run(
      Effect.gen(function* () {
        const need = { project: "app", task: "vl-7", message: messageOf() };
        const current = roomHubOf();
        current.inbox = { ...current.inbox, waiting: [need] };
        const peer = yield* roomPeer(current);
        yield* roomsWhen(peer.status, (rooms) => rooms?.waiting.length === 1);
        yield* peer.plugins.setPlugin({ id: "rooms", enabled: false });
        assert.isUndefined((yield* peer.status.publish).rooms);
      }),
    ),
  );
});

describe("what a person does in a room", () => {
  it.effect("reads the room, with what only this computer can say", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* roomPeer(roomHubOf());
        const read = (yield* rpc(peer, "peer.rooms.read", { ...place, after: 3, limit: 5 })) as {
          seq: number;
          hasCheckout: boolean;
          capacities: unknown;
        };
        assert.strictEqual(read.seq, 12);
        assert.isFalse(read.hasCheckout);
        assert.deepStrictEqual(read.capacities, {});
        assert.lengthOf(callsTo(peer, "GET", `${ROOM}?after=3&limit=5`), 1);
      }),
    ),
  );

  it.effect("posts with this computer as the environment, and names no run", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* roomPeer(roomHubOf());
        const to = [{ kind: "agent", email: EVA }];
        yield* rpc(peer, "peer.rooms.post", { ...place, op: "o1", text: "Hi", to });
        assert.deepStrictEqual(bodyOf(callsTo(peer, "POST", ROOM)[0]), {
          op: "o1",
          text: "Hi",
          to,
          environment: TEST_ENVIRONMENT,
        });
      }),
    ),
  );

  it.effect("passes on, naming this computer, and declines with a reason", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* roomPeer(roomHubOf());
        yield* rpc(peer, "peer.rooms.pass", { ...place, seq: 12, expect: "waiting" });
        yield* rpc(peer, "peer.rooms.decline", { ...place, seq: 13, reason: "Not now" });
        const url = (seq: number) => `${ROOM}/${seq}/deliveries/${encodeURIComponent(BOB)}`;
        assert.deepStrictEqual(bodyOf(callsTo(peer, "PATCH", url(12))[0]), {
          move: "pass",
          environment: TEST_ENVIRONMENT,
          expect: "waiting",
        });
        assert.deepStrictEqual(bodyOf(callsTo(peer, "PATCH", url(13))[0]), {
          move: "decline",
          reason: "Not now",
        });
      }),
    ),
  );

  it.effect("withdraws, and marks seen", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* roomPeer(roomHubOf());
        yield* rpc(peer, "peer.rooms.withdraw", { ...place, seq: 12 });
        yield* rpc(peer, "peer.rooms.seen", { ...place, seq: 12 });
        assert.lengthOf(callsTo(peer, "DELETE", `${ROOM}/12`), 1);
        assert.deepStrictEqual(bodyOf(callsTo(peer, "POST", `${ROOM}/seen`)[0]), { seq: 12 });
      }),
    ),
  );

  it.effect("sends reach with a run's capacity, personal when Peer cannot tell", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* roomPeer(roomHubOf());
        const answer = yield* rpc(peer, "peer.rooms.setReach", {
          workspace: "acme",
          project: "app",
          run: "run_x",
          reach: "team",
        });
        assert.deepStrictEqual(answer, {
          reach: { run: "run_x", reach: "team", email: BOB, capacity: "shared" },
        });
        assert.deepStrictEqual(
          bodyOf(callsTo(peer, "PUT", `${ACME}/projects/app/runs/run_x/reach`)[0]),
          { reach: "team", capacity: "personal" },
        );
      }),
    ),
  );

  it("knows a run's capacity from the shared instance its Peer thread is on", () => {
    const threads = [{ id: "t1", providerInstanceId: "peer-acme-app-claude" }];
    const run = { runtime: "peer", thread: "peer:t1" };
    assert.strictEqual(runCapacity(run, ["peer-acme-app-claude"], threads), "shared");
    assert.strictEqual(runCapacity(run, [], threads), "personal");
    assert.strictEqual(runCapacity(undefined, ["a"], threads), "personal");
    assert.strictEqual(runCapacity({ runtime: "herdr" }, ["a"], threads), "personal");
    assert.strictEqual(runCapacity({ ...run, thread: "peer:gone" }, ["a"], threads), "personal");
  });
});

describe("the status", () => {
  it.effect("shows what waits, clipped, with each room's sequence", () =>
    run(
      Effect.gen(function* () {
        const current = roomHubOf();
        const many = Array.from({ length: 40 }, (_, at) => ({
          project: "app",
          task: "vl-7",
          message: messageOf({ seq: at + 1, text: "w ".repeat(400) }),
        }));
        current.inbox = {
          waiting: many,
          mentions: [
            {
              project: "app",
              task: "vl-7",
              message: messageOf({ seq: 41, author: { email: EVA, run: "run_e" }, to: [] }),
            },
          ],
          work: [],
          seqs: { app: { "vl-7": 41 } },
          revs: { app: { "vl-7": 57 } },
        };
        const peer = yield* roomPeer(current);
        const rooms = yield* roomsWhen(peer.status, (next) => next?.mentions.length === 1);
        assert.lengthOf(rooms?.waiting ?? [], 32);
        assert.isAtMost(rooms?.waiting[0]?.text.length ?? 0, 200);
        assert.deepStrictEqual(rooms?.mentions[0], {
          workspace: "acme",
          project: "app",
          task: "vl-7",
          seq: 41,
          author: EVA,
          agent: true,
          text: "Why this total?",
          at: NOW,
        });
        assert.deepStrictEqual(rooms?.seqs, { acme: { app: { "vl-7": 41 } } });
        assert.deepStrictEqual(rooms?.revs, { acme: { app: { "vl-7": 57 } } });
      }),
    ),
  );

  it.effect("reads the inbox again on a rooms ping", () =>
    run(
      Effect.gen(function* () {
        const current = roomHubOf();
        const peer = yield* roomPeer(current);
        yield* roomsWhen(peer.status, (rooms) => rooms !== undefined);
        current.inbox = { ...current.inbox, seqs: { app: { "vl-7": 2 } } };
        const { hubChanges } = yield* contributionsOf(peer);
        assert.deepStrictEqual(hubChanges?.changes, ["rooms"]);
        assert.isTrue(hubChanges?.ownEcho);
        yield* hubChanges!.onPing({
          workspace: "acme",
          change: "rooms",
          origin: null,
          data: { project: "app", task: "vl-7", seq: 2 },
        } as never);
        const rooms = yield* roomsWhen(peer.status, (next) => next?.seqs.acme?.app?.["vl-7"] === 2);
        assert.isDefined(rooms);
      }),
    ),
  );

  it.effect("a delivery's move reaches the status on its ping, with no new message", () =>
    run(
      Effect.gen(function* () {
        const current = roomHubOf();
        current.inbox = {
          ...current.inbox,
          seqs: { app: { "vl-7": 2 } },
          revs: { app: { "vl-7": 2 } },
        };
        const peer = yield* roomPeer(current);
        yield* roomsWhen(peer.status, (next) => next?.revs.acme?.app?.["vl-7"] === 2);
        current.inbox = { ...current.inbox, revs: { app: { "vl-7": 3 } } };
        const { hubChanges } = yield* contributionsOf(peer);
        yield* hubChanges!.onPing({
          workspace: "acme",
          change: "rooms",
          origin: null,
          data: { project: "app", task: "vl-7", seq: 2 },
        } as never);
        const rooms = yield* roomsWhen(peer.status, (next) => next?.revs.acme?.app?.["vl-7"] === 3);
        assert.strictEqual(rooms?.seqs.acme?.app?.["vl-7"], 2);
      }),
    ),
  );

  it.effect("leaves nothing from a Hub that has no inbox route yet", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* roomPeer(
          roomHubOf({
            route: (_method, url) =>
              url.includes("/rooms/inbox")
                ? [404, { error: { code: "not_found", message: "no such route" } }]
                : undefined,
          }),
        );
        const rooms = yield* roomsWhen(peer.status, (next) => next !== undefined);
        assert.deepStrictEqual(rooms, { waiting: [], mentions: [], seqs: {}, revs: {} });
      }),
    ),
  );
});

describe("work assigned to this computer", () => {
  it.effect("fails a passed message without a checkout, saying so in the room", () =>
    run(
      Effect.gen(function* () {
        const url = `${ROOM}/12/deliveries/${encodeURIComponent(BOB)}`;
        let moved = 0;
        let bothMoves = () => {};
        const both = new Promise<void>((resolve) => {
          bothMoves = resolve;
        });
        const current = roomHubOf({
          route: (method, called) => {
            if (method !== "PATCH" || !called.includes(url)) return undefined;
            moved += 1;
            if (moved === 2) bothMoves();
            return [200, { message: messageOf() }];
          },
        });
        current.inbox = {
          ...current.inbox,
          work: [
            {
              project: "app",
              task: "vl-7",
              message: messageOf({
                author: { email: BOB },
                to: [{ kind: "agent", email: BOB, state: "passed" }],
              }),
            },
          ],
        };
        const peer = yield* roomPeer(current);
        yield* Effect.promise(() => both);
        const moves = callsTo(peer, "PATCH", url).map(bodyOf);
        assert.deepStrictEqual(moves, [
          { move: "take", environment: TEST_ENVIRONMENT, expect: "passed" },
          {
            move: "fail",
            environment: TEST_ENVIRONMENT,
            reason: "This computer has no checkout of the project.",
          },
        ]);
      }),
    ),
  );
});
