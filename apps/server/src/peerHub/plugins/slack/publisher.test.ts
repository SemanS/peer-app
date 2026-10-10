import { describe, expect, it } from "@effect/vitest";
import { PeerHubError, type PeerSlackMe } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import type { Slack } from "./publisher.ts";
import { publisher } from "./publisher.ts";
import type { SlackLedger } from "./ledger.ts";
import type { SlackWait } from "./waits.ts";
import type { World } from "./world.ts";

type Stored = Effect.Success<SlackLedger["read"]>;
const MINUTE = 60_000;

const me = (
  over: {
    readonly settings?: Partial<PeerSlackMe["settings"]>;
    readonly mode?: string;
    readonly link?: PeerSlackMe["link"];
  } = {},
): PeerSlackMe => ({
  connected: true,
  team: { id: "T1", name: "Acme" },
  bot: { name: "Peer" },
  link: "link" in over ? (over.link ?? null) : { slackUser: "U1", name: "ana", linkedAt: "x" },
  pending: null,
  settings: {
    enabled: true,
    delayMinutes: 5,
    place: "thread",
    kinds: ["approval", "question", "finished", "blocked"],
    ...over.settings,
  },
  projects: [{ id: "webshop", name: "Webshop", mode: over.mode ?? "thread" }],
});

const approval = (over: Partial<SlackWait> = {}): SlackWait => ({
  waitKey: "peer:t1:req:r1",
  subject: { key: "peer:t1", title: "Fix the login", agent: "Claude", computer: "Ana's Mac" },
  kind: "approval",
  workspace: "acme",
  project: "webshop",
  title: "Fix the login",
  text: "Run the migration?",
  decisions: ["accept", "decline"],
  since: "1970-01-01T00:00:00.000Z",
  ...over,
});
/** A herdr agent that finished: its key repeats within a turn. */
const herdrDone = (): SlackWait => ({
  waitKey: "herdr:claude:s1:done:4",
  subject: {
    key: "herdr:claude:s1",
    title: "Billing",
    agent: "Claude Code",
    computer: "Ana's Mac",
  },
  kind: "finished",
  workspace: "acme",
  project: "webshop",
  title: "Billing",
  text: "Done. Next?",
  since: "1970-01-01T00:00:00.000Z",
});

interface Call {
  readonly kind: "open" | "withdraw";
  readonly workspace: string;
  readonly body: Record<string, unknown>;
}

/** A publisher over an in-memory ledger and a Hub that records what it is asked and answers as told. */
const rig = (options: { readonly settings?: PeerSlackMe } = {}) =>
  Effect.gen(function* () {
    const stored = yield* Ref.make<Stored>({ waits: {}, delivered: {} });
    const calls: Array<Call> = [];
    const now = {
      waits: [] as ReadonlyArray<SlackWait>,
      why: "handled" as ReturnType<World["why"]>,
      /** What the Hub answers to opening an ask. */
      open: (): Effect.Effect<unknown, PeerHubError> => Effect.succeed({}),
      withdraw: (): Effect.Effect<unknown, PeerHubError> => Effect.succeed({}),
      threads: true,
    };
    const s: Slack = {
      environment: "ana-laptop",
      hub: {
        open: (workspace: string, body: object) => {
          calls.push({ kind: "open", workspace, body: body as Record<string, unknown> });
          return now.open();
        },
        withdraw: (workspace: string, body: object) => {
          calls.push({ kind: "withdraw", workspace, body: body as Record<string, unknown> });
          return now.withdraw();
        },
      } as never,
      ledger: {
        read: Ref.get(stored),
        update: (f) => Ref.update(stored, f),
      },
      world: () =>
        Effect.succeed(
          now.threads ? { waits: now.waits, sources: new Map(), why: () => now.why } : undefined,
        ),
      threads: () => undefined,
      agents: { promptRuntime: () => Effect.void },
      mine: new Map([["acme", options.settings ?? me()]]),
      paused: new Set(),
    };
    /** A publisher that has just started: it has confirmed nothing yet. */
    const start = (off = false) => publisher(s, off);
    return { s, now, calls, stored, start, pass: start() };
  });

const opens = (calls: ReadonlyArray<Call>) => calls.filter((call) => call.kind === "open");

describe("the Slack publisher", () => {
  it.effect("posts nothing before the member's delay, and one ask after it", () =>
    Effect.gen(function* () {
      const { now, calls, pass, stored } = yield* rig();
      now.waits = [approval()];
      yield* pass;
      yield* TestClock.adjust(`${5 * MINUTE - 1} millis`);
      yield* pass;
      expect(calls).toEqual([]);
      yield* TestClock.adjust("1 millis");
      yield* pass;
      yield* pass;
      expect(calls).toEqual([
        {
          kind: "open",
          workspace: "acme",
          body: {
            environment: "ana-laptop",
            waitKey: "peer:t1:req:r1",
            project: "webshop",
            subject: approval().subject,
            kind: "approval",
            text: "Run the migration?",
            decisions: ["accept", "decline"],
          },
        },
      ]);
      expect((yield* Ref.get(stored)).waits["peer:t1:req:r1"]).toMatchObject({
        workspace: "acme",
        opened: true,
        closed: false,
        occurrence: 1,
      });
    }),
  );

  it.effect("posts nothing for a decision point handled inside the delay", () =>
    Effect.gen(function* () {
      const { now, calls, pass, stored } = yield* rig();
      now.waits = [approval()];
      yield* pass;
      yield* TestClock.adjust("90 seconds");
      now.waits = [];
      yield* pass;
      yield* TestClock.adjust("1 hour");
      yield* pass;
      expect(calls).toEqual([]);
      expect((yield* Ref.get(stored)).waits).toEqual({});
    }),
  );

  it.effect("withdraws an ask that is over: handled, or ended when its thread is gone", () =>
    Effect.gen(function* () {
      const { now, calls, pass, stored } = yield* rig({
        settings: me({ settings: { delayMinutes: 0 } }),
      });
      now.waits = [approval()];
      yield* pass;
      now.waits = [];
      yield* pass;
      now.why = "ended";
      now.waits = [approval({ waitKey: "peer:t2:req:r2" })];
      yield* pass;
      now.waits = [];
      yield* pass;
      expect(calls.filter((call) => call.kind === "withdraw").map((call) => call.body)).toEqual([
        { environment: "ana-laptop", waitKey: "peer:t1:req:r1", reason: "handled" },
        { environment: "ana-laptop", waitKey: "peer:t2:req:r2", reason: "ended" },
      ]);
      // Over, the entry waits for the key's next occurrence.
      expect((yield* Ref.get(stored)).waits["peer:t1:req:r1"]).toMatchObject({
        firstSeenAt: null,
        opened: false,
        occurrence: 2,
      });
    }),
  );

  it.effect(
    "on restart opens what is open again, once, and withdraws what vanished meanwhile",
    () =>
      Effect.gen(function* () {
        const first = yield* rig({ settings: me({ settings: { delayMinutes: 0 } }) });
        first.now.waits = [approval(), approval({ waitKey: "peer:t2:req:r2" })];
        yield* first.pass;
        expect(opens(first.calls)).toHaveLength(2);

        // The same ledger, a new process: the Hub is asked again for the one still open.
        const calls: Array<Call> = [];
        const restarted: Slack = {
          ...first.s,
          hub: {
            open: (workspace: string, body: object) => {
              calls.push({ kind: "open", workspace, body: body as Record<string, unknown> });
              return Effect.succeed({});
            },
            withdraw: (workspace: string, body: object) => {
              calls.push({ kind: "withdraw", workspace, body: body as Record<string, unknown> });
              return Effect.succeed({});
            },
          } as never,
        };
        first.now.waits = [approval()];
        const pass = publisher(restarted);
        yield* pass;
        yield* pass;
        expect(calls.map((call) => [call.kind, call.body.waitKey])).toEqual([
          ["open", "peer:t1:req:r1"],
          ["withdraw", "peer:t2:req:r2"],
        ]);
      }),
  );

  it.effect("opens a closed key that appears again as the next occurrence", () =>
    Effect.gen(function* () {
      const { now, calls, pass } = yield* rig({ settings: me({ settings: { delayMinutes: 0 } }) });
      now.waits = [herdrDone()];
      yield* pass;
      now.waits = [];
      yield* pass;
      now.waits = [herdrDone()];
      yield* pass;
      now.waits = [];
      yield* pass;
      now.waits = [herdrDone()];
      yield* pass;
      expect(calls.map((call) => [call.kind, call.body.waitKey])).toEqual([
        ["open", "herdr:claude:s1:done:4"],
        ["withdraw", "herdr:claude:s1:done:4"],
        ["open", "herdr:claude:s1:done:4#2"],
        ["withdraw", "herdr:claude:s1:done:4#2"],
        ["open", "herdr:claude:s1:done:4#3"],
      ]);
    }),
  );

  it.effect("does not open an ask the Hub says is over, or again while it stays so", () =>
    Effect.gen(function* () {
      const { now, calls, pass, stored } = yield* rig({
        settings: me({ settings: { delayMinutes: 0 } }),
      });
      now.open = () => Effect.succeed("closed");
      now.waits = [approval()];
      yield* pass;
      yield* pass;
      expect(opens(calls)).toHaveLength(1);
      expect((yield* Ref.get(stored)).waits["peer:t1:req:r1"]).toMatchObject({
        opened: true,
        closed: true,
      });
      // It is over: nothing to withdraw when the decision point goes.
      now.waits = [];
      yield* pass;
      expect(calls).toHaveLength(1);
      expect((yield* Ref.get(stored)).waits["peer:t1:req:r1"]).toMatchObject({ occurrence: 2 });
    }),
  );

  it.effect("stops opening for a workspace Slack is off for, until the next ping", () =>
    Effect.gen(function* () {
      const { s, now, calls, pass } = yield* rig({
        settings: me({ settings: { delayMinutes: 0 } }),
      });
      now.open = () => Effect.succeed({ off: "project-off" });
      now.waits = [approval()];
      yield* pass;
      yield* pass;
      expect(opens(calls)).toHaveLength(1);
      expect(s.paused.has("acme")).toBe(true);
      // A ping lets the loop clear the pause; the next pass tries again.
      s.paused.delete("acme");
      now.open = () => Effect.succeed({});
      yield* pass;
      expect(opens(calls)).toHaveLength(2);
    }),
  );

  it.effect("respects what the member chose: on, linked, kinds, and the project's mode", () =>
    Effect.gen(function* () {
      for (const settings of [
        me({ settings: { delayMinutes: 0, enabled: false } }),
        me({ settings: { delayMinutes: 0 }, link: null }),
        me({ settings: { delayMinutes: 0, kinds: ["finished"] } }),
        me({ settings: { delayMinutes: 0 }, mode: "off" }),
        me({ settings: { delayMinutes: 0 }, mode: "unset" }),
      ]) {
        const { now, calls, pass, stored } = yield* rig({ settings });
        now.waits = [approval()];
        yield* pass;
        expect(calls).toEqual([]);
        expect((yield* Ref.get(stored)).waits).toEqual({});
      }
      const { now, calls, pass } = yield* rig({
        settings: me({ settings: { delayMinutes: 0, kinds: ["approval"] } }),
      });
      now.waits = [approval(), herdrDone()];
      yield* pass;
      expect(opens(calls).map((call) => call.body.waitKey)).toEqual(["peer:t1:req:r1"]);
    }),
  );

  it.effect("ends its look when the Hub cannot be reached, and takes it up again", () =>
    Effect.gen(function* () {
      const { now, calls, pass } = yield* rig({ settings: me({ settings: { delayMinutes: 0 } }) });
      const second = approval({ waitKey: "peer:t2:req:r2" });
      now.open = () => Effect.fail(new PeerHubError({ detail: "Could not reach the hub." }));
      now.waits = [approval(), second];
      yield* pass;
      expect(opens(calls)).toHaveLength(1);
      // A refusal of one ask does not hold up the others; it is tried again with the next look.
      now.open = () =>
        Effect.fail(new PeerHubError({ detail: "bad", code: "bad_request", refused: true }));
      yield* pass;
      expect(opens(calls).map((call) => call.body.waitKey)).toEqual([
        "peer:t1:req:r1",
        "peer:t1:req:r1",
        "peer:t2:req:r2",
      ]);
      now.open = () => Effect.succeed({});
      yield* pass;
      yield* pass;
      expect(opens(calls)).toHaveLength(5);
    }),
  );

  it.effect("concludes nothing while T3's threads cannot be read", () =>
    Effect.gen(function* () {
      const { now, calls, pass, stored } = yield* rig({
        settings: me({ settings: { delayMinutes: 0 } }),
      });
      now.waits = [approval()];
      yield* pass;
      now.threads = false;
      yield* pass;
      yield* pass;
      expect(calls.map((call) => call.kind)).toEqual(["open"]);
      expect((yield* Ref.get(stored)).waits["peer:t1:req:r1"]).toMatchObject({ opened: true });
    }),
  );

  it.effect("leaves a workspace whose settings it has not read alone", () =>
    Effect.gen(function* () {
      const { s, now, calls, start, pass } = yield* rig({
        settings: me({ settings: { delayMinutes: 0 } }),
      });
      now.waits = [approval()];
      yield* pass;
      s.mine.clear();
      now.waits = [];
      yield* start();
      expect(calls.map((call) => call.kind)).toEqual(["open"]);
    }),
  );

  it.effect("withdraws everything it opened when turned off, whatever the settings say", () =>
    Effect.gen(function* () {
      const { s, now, calls, start, pass, stored } = yield* rig({
        settings: me({ settings: { delayMinutes: 0 } }),
      });
      now.waits = [approval(), herdrDone()];
      yield* pass;
      s.mine.clear();
      yield* start(true);
      expect(calls.filter((call) => call.kind === "withdraw").map((call) => call.body)).toEqual([
        { environment: "ana-laptop", waitKey: "peer:t1:req:r1", reason: "off" },
        { environment: "ana-laptop", waitKey: "herdr:claude:s1:done:4", reason: "off" },
      ]);
      expect(Object.values((yield* Ref.get(stored)).waits).every((e) => !e.opened)).toBe(true);
    }),
  );

  it.effect(
    "does not look at the threads while Slack is off for everyone and nothing is open",
    () =>
      Effect.gen(function* () {
        const { s, now, calls } = yield* rig({ settings: me({ settings: { enabled: false } }) });
        let looked = 0;
        const watching: Slack = {
          ...s,
          world: (...args) => {
            looked += 1;
            return s.world(...args);
          },
        };
        now.waits = [approval()];
        yield* publisher(watching);
        expect(looked).toBe(0);
        expect(calls).toEqual([]);
      }),
  );
});
