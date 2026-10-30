// @effect-diagnostics preferSchemaOverJson:off - the bodies the Hub was sent.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import { NOT_DELIVERED, taskOf } from "./client/hub.ts";
import {
  ANA,
  LIST,
  PEER_ACCEPTANCE_METHODS as methods,
  VL7,
  acceptedEntry,
  decidedAnswer,
  listAnswer,
  ready,
  withdrawnEntry,
  writes,
} from "./fixtures.test.ts";
import { statusLine, taskFact } from "./tell.ts";

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const vl7 = { workspace: "acme", project: "pay", task: "vl-7" };
const vl9 = { workspace: "acme", project: "pay", task: "vl-9" };

describe("acceptance plugin", () => {
  it.effect("accept_and_withdraw_go_to_the_routes", () =>
    run(
      Effect.gen(function* () {
        const rows: { current: Record<string, unknown> } = { current: {} };
        const peer = yield* ready({
          route: (url, method) =>
            url === LIST
              ? [200, listAnswer(rows.current)]
              : url === VL7
                ? [200, decidedAnswer(method === "DELETE")]
                : undefined,
        });
        assert.isTrue(yield* peer.peer.plugins.isActive("acceptance"));
        const contribution = (yield* peer.peer.plugins.active)[0]!.contributions;
        // Acceptance stops nothing and gives agents no command.
        assert.isUndefined(contribution.commands);
        assert.isUndefined(contribution.hooks);
        assert.isUndefined(contribution.beforeReview);

        rows.current = { "vl-7": acceptedEntry() };
        const accepted = yield* peer.rpc[methods.peerAcceptanceAccept]({
          ...vl7,
          note: "Checked on staging",
          op: "op-1",
        });
        assert.deepStrictEqual(writes(peer.hub, "POST"), [
          { url: VL7, body: { op: "op-1", note: "Checked on staging" } },
        ]);
        assert.strictEqual(accepted.current?.by, ANA);
        assert.strictEqual(accepted.history.length, 1);
        const status = (yield* contribution.status!.read) as {
          accepted: ReadonlyArray<Record<string, unknown>>;
        };
        assert.deepStrictEqual(status.accepted, [
          {
            ...vl7,
            by: ANA,
            at: "2026-10-28T10:00:00Z",
            statusThen: "review",
            beforeReopening: false,
          },
        ]);

        // Withdrawn: no current acceptance, and the history keeps both, with the note.
        rows.current = { "vl-7": withdrawnEntry() };
        const withdrawn = yield* peer.rpc[methods.peerAcceptanceWithdraw]({
          ...vl7,
          note: "Refunds fail",
          op: "op-2",
        });
        assert.deepStrictEqual(writes(peer.hub, "DELETE"), [
          { url: VL7, body: { op: "op-2", note: "Refunds fail" } },
        ]);
        assert.isNull(withdrawn.current);
        assert.deepStrictEqual(
          withdrawn.history.map((event) => event.kind),
          ["accepted", "withdrawn"],
        );
        assert.deepStrictEqual(((yield* contribution.status!.read) as typeof status).accepted, []);
        assert.deepStrictEqual(yield* peer.rpc[methods.peerAcceptanceView](vl7), withdrawn);
      }),
    ),
  );

  it.effect("reports an acceptance the Hub took although reading it back fails", () =>
    run(
      Effect.gen(function* () {
        const reading = { fails: false };
        const peer = yield* ready({
          route: (url, method) =>
            url === LIST
              ? reading.fails
                ? [500, { error: { code: "internal", message: "Try again." } }]
                : [200, listAnswer()]
              : url === VL7
                ? [200, decidedAnswer(method === "DELETE")]
                : undefined,
        });
        reading.fails = true;
        const accepted = yield* peer.rpc[methods.peerAcceptanceAccept]({ ...vl7, op: "op-5" });
        assert.strictEqual(accepted.current?.by, ANA);
        assert.strictEqual(accepted.current?.statusThen, "review");
        const known = (yield* peer.peer.plugins.active)[0]!.contributions.status!.read;
        assert.strictEqual(
          ((yield* known) as { accepted: ReadonlyArray<{ task: string }> }).accepted[0]?.task,
          "vl-7",
        );
        const withdrawn = yield* peer.rpc[methods.peerAcceptanceWithdraw]({ ...vl7, op: "op-6" });
        assert.isNull(withdrawn.current);
      }),
    ),
  );

  it.effect("refuses an open task as not delivered, in the plugin's words", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready({
          route: (url) =>
            url === `${LIST}/pay/vl-9`
              ? [409, { error: { code: "not_delivered", message: "Task vl-9 is open." } }]
              : url === LIST
                ? [200, listAnswer()]
                : undefined,
        });
        const refused = yield* peer.rpc[methods.peerAcceptanceAccept]({ ...vl9, op: "op-3" }).pipe(
          Effect.flip,
        );
        assert.strictEqual(
          refused._tag === "PeerHubError" ? refused.detail : refused._tag,
          NOT_DELIVERED,
        );
      }),
    ),
  );

  it.effect("status_names_the_acceptance", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready({
          route: (url) =>
            url === LIST ? [200, listAnswer({ "vl-7": acceptedEntry() })] : undefined,
        });
        // The plugin reads the person's projects when it starts.
        yield* peer.peer.status.changes.pipe(
          Stream.filter((next) => (next.acceptance?.accepted.length ?? 0) > 0),
          Stream.runHead,
          Effect.map(Option.getOrThrow),
        );
        const printed = yield* peer.cli("status");
        assert.include(
          printed,
          'Acceptance: accepted by Ana on 2026-10-28 10:00 UTC (note: "Checked on staging").',
        );
        // `peer task list`, which the peer_task tool's list runs, says it on the task's line.
        const listed = (yield* peer.cli("task", ["list"])).split("\n");
        assert.isTrue(
          listed.some((line) => line.endsWith("id:vl-7 · accepted by Ana")),
          listed.join("\n"),
        );
        assert.isTrue(listed.some((line) => line.endsWith("id:vl-9")));
      }),
    ),
  );

  it.effect("reads the workspace again when the Hub pings acceptance.changed", () =>
    run(
      Effect.gen(function* () {
        const rows: { current: Record<string, unknown> } = { current: {} };
        const peer = yield* ready({
          route: (url) => (url === LIST ? [200, listAnswer(rows.current)] : undefined),
        });
        const listener = (yield* peer.peer.plugins.active)[0]!.contributions.hubChanges!;
        assert.include(listener.changes, "acceptance.changed");
        rows.current = { "vl-7": acceptedEntry() };
        yield* listener.onPing({
          change: "acceptance.changed",
          origin: "bob-laptop",
          data: { projectId: "pay" },
          workspace: "acme",
        });
        const seen = yield* peer.peer.status.changes.pipe(
          Stream.map((next) => next.acceptance?.accepted ?? []),
          Stream.filter((accepted) => accepted.length > 0),
          Stream.runHead,
          Effect.map(Option.getOrThrow),
        );
        assert.strictEqual(seen[0]?.task, "vl-7");
      }),
    ),
  );

  it.effect("turned off, refuses its methods before the Hub hears of them", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready({ route: () => undefined });
        yield* peer.peer.plugins.setPlugin({ id: "acceptance", enabled: false });
        const before = peer.hub.calls.length;
        const accepted = yield* peer.rpc[methods.peerAcceptanceAccept]({ ...vl7, op: "op-4" }).pipe(
          Effect.result,
        );
        assert.isTrue(Result.isFailure(accepted));
        assert.strictEqual(peer.hub.calls.length, before);
      }),
    ),
  );

  it.effect("inactive_without_the_feature", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready({ revision: null });
        assert.isFalse(yield* peer.peer.plugins.isActive("acceptance"));
        assert.notInclude(yield* peer.cli("status"), "Acceptance:");
        assert.notInclude(yield* peer.cli("task", ["list"]), "accepted by");
      }),
    ),
  );
});

describe("acceptance text", () => {
  const name = (email: string) => (email === ANA ? "Ana" : email);
  const VL7_PLACE = { workspace: "acme", project: "pay", task: "vl-7" };
  it("says an acceptance given before a reopening, and a withdrawal", () => {
    const reopened = taskOf(VL7_PLACE, acceptedEntry({ beforeReopening: true }));
    assert.strictEqual(
      statusLine(reopened, "open", name),
      'Acceptance: accepted by Ana on 2026-10-28 10:00 UTC, before the task was reopened (note: "Checked on staging").',
    );
    // Reopened and in review again: still given before the reopening.
    assert.include(statusLine(reopened, "review", name), "before the task was reopened");
    const withdrawn = taskOf(VL7_PLACE, withdrawnEntry());
    assert.strictEqual(
      statusLine(withdrawn, "done", name),
      'Acceptance: withdrawn by Ana on 2026-10-28 11:00 UTC (note: "Refunds fail"); not accepted now.',
    );
    assert.isNull(statusLine(undefined, "done", name));
  });

  it("gives a task list one fact while someone accepts the task now", () => {
    const row = taskOf(VL7_PLACE, acceptedEntry());
    assert.strictEqual(taskFact(row, "done", name), "accepted by Ana");
    const reopened = taskOf(VL7_PLACE, acceptedEntry({ beforeReopening: true }));
    assert.strictEqual(taskFact(reopened, "review", name), "accepted by Ana before reopening");
    assert.isNull(taskFact(taskOf(VL7_PLACE, withdrawnEntry()), "done", name));
    assert.isNull(taskFact(undefined, "done", name));
  });

  it("decodes the Hub's entry: history oldest first, without the Hub's sequence", () => {
    const row = taskOf(VL7_PLACE, withdrawnEntry());
    assert.isNull(row.current);
    assert.isFalse(row.beforeReopening);
    assert.deepStrictEqual(
      row.history.map((event) => [event.kind, event.at]),
      [
        ["accepted", "2026-10-28T10:00:00Z"],
        ["withdrawn", "2026-10-28T11:00:00Z"],
      ],
    );
    assert.notProperty(row.history[0], "seq");
    assert.deepStrictEqual(taskOf(VL7_PLACE, acceptedEntry()).current, {
      by: ANA,
      at: "2026-10-28T10:00:00Z",
      note: "Checked on staging",
      statusThen: "review",
    });
  });

  it("keeps whether a person or the policy gave an acceptance", () => {
    const row = taskOf(
      VL7_PLACE,
      acceptedEntry({
        acceptance: { ...acceptedEntry().acceptance, via: "policy" },
        history: [{ seq: 1, kind: "accepted", by: ANA, at: "2026-10-28T10:00:00Z", via: "policy" }],
      }),
    );
    assert.strictEqual(row.current?.via, "policy");
    assert.strictEqual(row.history[0]?.via, "policy");
    assert.isUndefined(taskOf(VL7_PLACE, acceptedEntry()).current?.via);
  });

  it.effect("reads a project's review policy, and saves one from the version read", () =>
    run(
      Effect.gen(function* () {
        const stored = { mode: "ask", version: 0 } as Record<string, unknown>;
        const POLICY = `${LIST}/pay/policy`;
        const peer = yield* ready({
          revision: 2,
          route: (url, method) => {
            if (url !== POLICY) return undefined;
            if (method !== "PUT") return [200, { ...stored, signals: ["no-report"] }];
            const body = JSON.parse(peer.hub.calls.at(-1)!.body) as Record<string, unknown>;
            if (body.version !== stored.version)
              return [
                409,
                {
                  error: {
                    code: "stale_policy",
                    message: "The policy changed.",
                    details: { version: stored.version, policy: stored },
                  },
                },
              ];
            Object.assign(stored, {
              mode: body.mode,
              version: (stored.version as number) + 1,
              updatedAt: "2026-10-30T10:00:00Z",
              updatedBy: ANA,
            });
            return [200, { ...stored, changed: true }];
          },
        });
        const place = { workspace: "acme", project: "pay" };
        assert.deepStrictEqual(yield* peer.rpc[methods.peerAcceptanceReviewPolicy](place), {
          ...place,
          available: true,
          policy: { mode: "ask", version: 0 },
        });
        const saved = yield* peer.rpc[methods.peerAcceptanceSetReviewPolicy]({
          ...place,
          mode: "auto",
          version: 0,
        });
        assert.deepStrictEqual(saved, {
          kind: "saved",
          policy: { mode: "auto", version: 1, updatedAt: "2026-10-30T10:00:00Z", updatedBy: ANA },
        });
        const sent = writes(peer.hub, "PUT")[0]!;
        assert.strictEqual(sent.url, POLICY);
        assert.strictEqual(sent.body.mode, "auto");
        assert.strictEqual(sent.body.version, 0);
        assert.match(String(sent.body.op), /^[0-9a-f]{24}$/);
        // A second lead saving from the version both read is told what is stored now.
        const stale = yield* peer.rpc[methods.peerAcceptanceSetReviewPolicy]({
          ...place,
          mode: "ask",
          version: 0,
        });
        assert.strictEqual(stale.kind, "stale");
        assert.strictEqual(stale.policy.version, 1);
        assert.strictEqual(stale.policy.mode, "auto");
      }),
    ),
  );

  it.effect("on a Hub without review policies, reads the default and saves nothing", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready({ revision: 1 });
        const place = { workspace: "acme", project: "pay" };
        assert.deepStrictEqual(yield* peer.rpc[methods.peerAcceptanceReviewPolicy](place), {
          ...place,
          available: false,
          policy: { mode: "ask", version: 0 },
        });
        const refused = yield* peer.rpc[methods.peerAcceptanceSetReviewPolicy]({
          ...place,
          mode: "auto",
          version: 0,
        }).pipe(Effect.result);
        assert.isTrue(Result.isFailure(refused));
        assert.isFalse(peer.hub.calls.some((call) => call.url?.endsWith("/policy")));
      }),
    ),
  );
});
