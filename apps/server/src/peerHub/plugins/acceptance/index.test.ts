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
  acceptedRow,
  ready,
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
        const rows: { current: ReadonlyArray<unknown> } = { current: [] };
        const peer = yield* ready({
          route: (url) =>
            url === LIST
              ? [200, { acceptances: rows.current }]
              : url === VL7
                ? [200, { accepted: true }]
                : undefined,
        });
        assert.isTrue(yield* peer.peer.plugins.isActive("acceptance"));
        const contribution = (yield* peer.peer.plugins.active)[0]!.contributions;
        // Acceptance stops nothing and gives agents no command.
        assert.isUndefined(contribution.commands);
        assert.isUndefined(contribution.hooks);
        assert.isUndefined(contribution.beforeReview);

        rows.current = [acceptedRow()];
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
            at: "2026-10-28T10:00:00.000Z",
            statusThen: "review",
          },
        ]);

        // Withdrawn: no current acceptance, and the history keeps both, with the note.
        rows.current = [
          {
            project: "pay",
            task: "vl-7",
            current: null,
            history: [
              ...acceptedRow().history,
              { kind: "withdrawn", by: ANA, at: "2026-10-28T11:00:00.000Z", note: "Refunds fail" },
            ],
          },
        ];
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

  it.effect("refuses an open task as not delivered, in the plugin's words", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready({
          route: (url) =>
            url === `${LIST}/pay/vl-9`
              ? [409, { error: { code: "not_delivered", message: "Task vl-9 is open." } }]
              : url === LIST
                ? [200, { acceptances: [] }]
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
          route: (url) => (url === LIST ? [200, { acceptances: [acceptedRow()] }] : undefined),
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
        const rows: { current: ReadonlyArray<unknown> } = { current: [] };
        const peer = yield* ready({
          route: (url) => (url === LIST ? [200, { acceptances: rows.current }] : undefined),
        });
        const listener = (yield* peer.peer.plugins.active)[0]!.contributions.hubChanges!;
        assert.include(listener.changes, "acceptance.changed");
        rows.current = [acceptedRow()];
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
  it("says an acceptance given before a reopening, and a withdrawal", () => {
    const row = taskOf("acme", acceptedRow());
    assert.strictEqual(
      statusLine(row, "open", name),
      'Acceptance: accepted by Ana on 2026-10-28 10:00 UTC, before the task was reopened (note: "Checked on staging").',
    );
    const withdrawn = taskOf("acme", {
      project: "pay",
      task: "vl-7",
      current: null,
      history: [{ kind: "withdrawn", by: ANA, at: "2026-10-28T11:00:00.000Z" }],
    });
    assert.strictEqual(
      statusLine(withdrawn, "done", name),
      "Acceptance: withdrawn by Ana on 2026-10-28 11:00 UTC; not accepted now.",
    );
    assert.isNull(statusLine(undefined, "done", name));
  });

  it("gives a task list one fact while someone accepts the task now", () => {
    const row = taskOf("acme", acceptedRow());
    assert.strictEqual(taskFact(row, "done", name), "accepted by Ana");
    assert.strictEqual(taskFact(row, "open", name), "accepted by Ana before reopening");
    const withdrawn = taskOf("acme", {
      project: "pay",
      task: "vl-7",
      current: null,
      history: [{ kind: "withdrawn", by: ANA, at: "2026-10-28T11:00:00.000Z" }],
    });
    assert.isNull(taskFact(withdrawn, "done", name));
    assert.isNull(taskFact(undefined, "done", name));
  });

  it("reads the current acceptance flat on the row or as `current`", () => {
    const flat = taskOf("acme", acceptedRow({ history: undefined }));
    assert.strictEqual(flat.current?.note, "Checked on staging");
    assert.deepStrictEqual(flat.history, []);
    const nested = taskOf("acme", {
      project: "pay",
      task: "vl-7",
      current: { by: ANA, at: "2026-10-28T10:00:00.000Z", statusThen: "done" },
    });
    assert.strictEqual(nested.current?.statusThen, "done");
  });
});
