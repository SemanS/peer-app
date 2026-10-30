import { assert, describe, it } from "@effect/vitest";
import { PeerHubError, type PeerRoomInbox, type PeerRoomMessage } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { runQueues, stillTellable, tellable } from "./client/queue.ts";
import { BOB, messageOf } from "./fixtures.test.ts";
import type { Heard } from "./text.ts";

const heard = (seq: number, over: Partial<Heard> = {}): Heard => ({
  ref: `vl-7:${seq}`,
  workspace: "acme",
  project: "app",
  kind: "passed",
  seq,
  task: "vl-7",
  taskName: "VL-7",
  author: "Eva",
  owner: "Bob",
  text: "Why?",
  ...over,
});
const inboxOf = (seqs: ReadonlyArray<number>): PeerRoomInbox => ({
  waiting: [],
  mentions: [],
  seqs: {},
  revs: {},
  work: seqs.map((seq) => ({ project: "app", task: "vl-7", message: messageOf({ seq }) })),
});
const inState = (state: string, seq = 12) =>
  messageOf({ seq, to: [{ kind: "agent", email: BOB, state }] });
const refs = (list: ReadonlyArray<Heard>) => list.map((one) => one.ref);

describe("what a run was told", () => {
  it("leaves the queue, is remembered, and still names its run", () => {
    const queues = runQueues();
    queues.add("run_1", heard(12));
    queues.settle("run_1", "vl-7:12");
    assert.deepStrictEqual(queues.of("run_1"), []);
    assert.isTrue(queues.wasTold("run_1", "vl-7:12"));
    assert.strictEqual(queues.runOf("acme", "app", "vl-7:12"), "run_1");
  });

  it("keeps a first prompt's message queued until its delivery leaves the work list", () => {
    const queues = runQueues();
    queues.add("run_1", heard(12, { promptedAt: 5 }));
    assert.isTrue(queues.wasTold("run_1", "vl-7:12"));
    assert.deepStrictEqual(refs(queues.of("run_1")), ["vl-7:12"]);
    queues.prune("acme", inboxOf([]));
    assert.isFalse(queues.wasTold("run_1", "vl-7:12"));
    assert.deepStrictEqual(queues.of("run_1"), []);
  });

  it("is not overwritten by a later read's offer, so a prompted message stays marked", () => {
    const queues = runQueues();
    queues.add("run_1", heard(12, { promptedAt: 5 }));
    queues.add("run_1", heard(12));
    assert.strictEqual(queues.of("run_1")[0]?.promptedAt, 5);
  });

  it("does not count a message taken back out of the queue", () => {
    const queues = runQueues();
    queues.add("run_1", heard(12));
    queues.remove("run_1", "vl-7:12");
    assert.isFalse(queues.wasTold("run_1", "vl-7:12"));
  });
});

describe("the inbox read", () => {
  it("drops a message that left the work list, and keeps what is listed", () => {
    const queues = runQueues();
    queues.add("run_1", heard(12));
    queues.add("run_1", heard(13));
    queues.prune("acme", inboxOf([13]));
    assert.deepStrictEqual(refs(queues.of("run_1")), ["vl-7:13"]);
  });

  it("leaves other workspaces and projects to their own reads", () => {
    const queues = runQueues();
    queues.add("run_1", heard(12, { workspace: "other" }));
    queues.add("run_2", heard(12, { project: "web" }));
    queues.prune("acme", inboxOf([12]));
    assert.lengthOf(queues.of("run_1"), 1);
    assert.lengthOf(queues.of("run_2"), 0);
  });

  it("proves nothing by a full list, which may have left a message out", () => {
    const queues = runQueues();
    queues.add("run_1", heard(500));
    queues.prune("acme", inboxOf(Array.from({ length: 64 }, (_, at) => at + 1)));
    assert.lengthOf(queues.of("run_1"), 1);
  });

  it("finds the run that holds a message, in its own place only", () => {
    const queues = runQueues();
    queues.add("run_1", heard(12));
    assert.strictEqual(queues.runOf("acme", "app", "vl-7:12"), "run_1");
    assert.isUndefined(queues.runOf("acme", "web", "vl-7:12"));
    assert.isUndefined(queues.runOf("acme", "app", "vl-7:13"));
  });

  it("forgets a workspace, or all of them, and what the person left", () => {
    const queues = runQueues();
    queues.add("run_1", heard(1));
    queues.add("run_2", heard(2, { workspace: "other" }));
    queues.forget("acme");
    assert.lengthOf(queues.of("run_1"), 0);
    assert.lengthOf(queues.of("run_2"), 1);
    queues.keep(["acme"]);
    assert.lengthOf(queues.of("run_2"), 0);
    queues.add("run_1", heard(1));
    queues.forget();
    assert.lengthOf(queues.of("run_1"), 0);
  });
});

describe("the check before telling", () => {
  it.each(["passed", "taken", "heard"])("tells a delivery that is %s", (state) => {
    assert.isTrue(stillTellable(inState(state), BOB));
  });

  it.each(["expired", "withdrawn", "declined", "answered", "failed", "waiting", "snoozed"])(
    "never tells one that is %s",
    (state) => {
      assert.isFalse(stillTellable(inState(state), BOB));
    },
  );

  it("never tells a message gone from the room, or addressed to someone else", () => {
    assert.isFalse(stillTellable(undefined, BOB));
    assert.isFalse(stillTellable(inState("passed"), "eva@acme.test"));
  });

  const check = (
    candidates: ReadonlyArray<Heard>,
    read: (one: Heard) => Effect.Effect<PeerRoomMessage | undefined, PeerHubError>,
  ) => {
    const queues = runQueues();
    for (const one of candidates) queues.add("run_1", one);
    return Effect.map(tellable({ queues, run: "run_1", candidates, me: BOB, read }), (told) => ({
      told: refs(told),
      left: refs(queues.of("run_1")),
    }));
  };

  it.effect("drops what ended from the queue, for every later session too", () =>
    Effect.gen(function* () {
      const answer = yield* check([heard(1), heard(2)], ({ seq }) =>
        Effect.succeed(inState(seq === 1 ? "expired" : "taken", seq)),
      );
      assert.deepStrictEqual(answer, { told: ["vl-7:2"], left: ["vl-7:2"] });
    }),
  );

  it.effect("drops a message the Hub no longer has", () =>
    Effect.gen(function* () {
      const answer = yield* check([heard(1)], () =>
        Effect.fail(new PeerHubError({ detail: "No.", status: 404 })),
      );
      assert.deepStrictEqual(answer, { told: [], left: [] });
    }),
  );

  it.effect("holds everything when the Hub does not answer, and loses nothing", () =>
    Effect.gen(function* () {
      const answer = yield* check([heard(1)], () =>
        Effect.fail(new PeerHubError({ detail: "Down.", status: 503 })),
      );
      assert.deepStrictEqual(answer, { told: [], left: ["vl-7:1"] });
    }),
  );

  it.effect("checks only what a step carries, and a dropped one lets the next be checked", () =>
    Effect.gen(function* () {
      const asked: number[] = [];
      const answer = yield* check(
        [1, 2, 3, 4, 5].map((seq) => heard(seq)),
        ({ seq }) =>
          Effect.sync(() => {
            asked.push(seq);
            return inState(seq === 2 ? "withdrawn" : "passed", seq);
          }),
      );
      assert.deepStrictEqual(asked, [1, 2, 3, 4]);
      assert.deepStrictEqual(answer.told, ["vl-7:1", "vl-7:3", "vl-7:4", "vl-7:5"]);
    }),
  );
});
