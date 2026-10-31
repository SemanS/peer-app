import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import {
  ANA,
  PEER_TEST_REPORTS_METHODS as methods,
  SLAVO,
  TESTS,
  ready,
  reportOf,
  sent,
} from "./fixtures.test.ts";
import { START_LINE } from "./index.ts";

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const place = { workspace: "acme", project: "pay", task: "vl-7" };

describe("test-reports plugin", () => {
  it.effect("reads, files and assigns through the Hub, and keeps summaries without text", () =>
    run(
      Effect.gen(function* () {
        const answer: { current: [number, unknown] } = {
          current: [200, { reports: [reportOf()] }],
        };
        const peer = yield* ready({
          route: (url) => (url.startsWith(TESTS) ? answer.current : undefined),
        });
        assert.isTrue(yield* peer.peer.plugins.isActive("test-reports"));
        const contribution = (yield* peer.peer.plugins.active)[0]!.contributions;
        assert.strictEqual(contribution.commands?.[0]?.name, "tests");
        assert.isAtMost(START_LINE.length, 300);

        assert.strictEqual((yield* peer.rpc[methods.peerTestsList](place)).length, 1);
        const status = (yield* contribution.status!.read) as {
          summaries: ReadonlyArray<Record<string, unknown>>;
        };
        assert.deepStrictEqual(status.summaries[0], {
          workspace: "acme",
          project: "pay",
          task: "vl-7",
          author: ANA,
          number: 1,
          result: "mixed",
          role: "author",
          at: "2026-10-27T14:03:00.000Z",
          passed: 1,
          failed: 0,
          unverified: 1,
          unowned: 0,
          asks: [SLAVO],
          failedLeft: 0,
        });

        // A person files from the task page: the Hub hears of no session and no computer.
        answer.current = [200, { report: reportOf({ number: 2 }), changed: true }];
        const filed = yield* peer.rpc[methods.peerTestsFile]({
          ...place,
          result: "pass",
          summary: "Checked by hand",
          items: [{ kind: "unverified", text: "Android", owner: "ana" }],
        });
        assert.strictEqual(filed.report.number, 2);
        const [body] = sent(peer.hub, "POST");
        assert.notProperty(body!, "session");
        assert.notProperty(body!, "environment");

        // A save made from report 2 while the author filed report 3 is stale and names it.
        answer.current = [
          409,
          {
            error: {
              code: "stale_report",
              message: "Report 3 is newer.",
              details: { number: 3, report: reportOf({ number: 3 }) },
            },
          },
        ];
        const stale = yield* peer.rpc[methods.peerTestsSetOwner]({
          ...place,
          author: ANA,
          index: 1,
          number: 2,
          owner: SLAVO,
        });
        assert.strictEqual(stale.kind, "stale");
        assert.strictEqual(stale.kind === "stale" ? stale.number : 0, 3);
        const patch = peer.hub.calls.at(-1);
        assert.strictEqual(patch?.method, "PATCH");
        assert.strictEqual(patch?.url, `${TESTS}/${encodeURIComponent(ANA)}/items/1`);
        assert.deepStrictEqual(JSON.parse(patch?.body ?? "{}"), { number: 2, owner: SLAVO });

        answer.current = [200, { report: reportOf({ number: 3 }) }];
        const saved = yield* peer.rpc[methods.peerTestsSetOwner]({
          ...place,
          author: ANA,
          index: 1,
          number: 3,
          owner: null,
        });
        assert.strictEqual(saved.kind, "saved");

        answer.current = [200, { removed: true }];
        assert.isTrue((yield* peer.rpc[methods.peerTestsRemove](place)).removed);
        assert.deepStrictEqual(((yield* contribution.status!.read) as typeof status).summaries, []);
      }),
    ),
  );

  it.effect("reads a task again when the Hub pings tests.changed", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready({
          route: (url) => (url.startsWith(TESTS) ? [200, { reports: [reportOf()] }] : undefined),
        });
        const listener = (yield* peer.peer.plugins.active)[0]!.contributions.hubChanges!;
        assert.include(listener.changes, "tests.changed");
        // The listener only queues the read: the plugin's background loop asks the Hub.
        yield* listener.onPing({
          change: "tests.changed",
          origin: "bob-laptop",
          data: { projectId: "pay", taskId: "vl-7" },
          workspace: "acme",
        });
        const seen = yield* peer.peer.status.changes.pipe(
          Stream.map((next) => next.testReports?.summaries ?? []),
          Stream.filter((summaries) => summaries.length > 0),
          Stream.runHead,
          Effect.map(Option.getOrThrow),
        );
        assert.strictEqual(seen[0]?.task, "vl-7");
      }),
    ),
  );

  it.effect("reads the summaries of the person's projects when it starts", () =>
    run(
      Effect.gen(function* () {
        const { workspace: _, ...row } = {
          workspace: "acme",
          project: "pay",
          task: "vl-8",
          author: SLAVO,
          number: 4,
          result: "fail" as const,
          role: "review",
          at: "2026-10-27T15:00:00.000Z",
          passed: 0,
          failed: 2,
          unverified: 1,
          unowned: 1,
        };
        const peer = yield* ready({
          route: (url) =>
            url === "/v1/workspaces/acme/tests" ? [200, { summaries: [row] }] : undefined,
        });
        const seen = yield* peer.peer.status.changes.pipe(
          Stream.map((next) => next.testReports?.summaries ?? []),
          Stream.filter((summaries) => summaries.length > 0),
          Stream.runHead,
          Effect.map(Option.getOrThrow),
        );
        assert.deepStrictEqual(seen, [{ ...row, workspace: "acme" }]);
      }),
    ),
  );

  it.effect("names what a task inherited at an agent's start, as fenced team data", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready({
          route: (url) =>
            url.endsWith("/inherited")
              ? [
                  200,
                  {
                    items: [
                      {
                        task: "t-1",
                        key: "1.1",
                        title: "Contract",
                        author: ANA,
                        role: "author",
                        number: 2,
                        index: 0,
                        kind: "fail",
                        text: "malformed revision",
                        failed: true,
                        at: "t",
                      },
                    ],
                    capped: false,
                  },
                ]
              : undefined,
        });
        const inherited = yield* peer.rpc[methods.peerTestsInherited](place);
        assert.strictEqual(inherited.items[0]?.key, "1.1");
        const hooks = (yield* peer.peer.plugins.active)[0]!.contributions.hooks;
        const session = { workspace: "acme", project: "pay", task: "vl-7" };
        const text = yield* hooks!.sessionStart!({ session } as never);
        assert.include(String(text), "<shared-context>");
        assert.include(String(text), "- failed on 1.1: malformed revision");
        const none = yield* hooks!.sessionStart!({
          session: { ...session, task: undefined },
        } as never);
        assert.isNull(none);
      }),
    ),
  );

  it.effect("turned off, refuses its methods before the Hub hears of them", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready({ route: () => undefined });
        yield* peer.peer.plugins.setPlugin({ id: "test-reports", enabled: false });
        const before = peer.hub.calls.length;
        const listed = yield* peer.rpc[methods.peerTestsList](place).pipe(Effect.result);
        assert.isTrue(Result.isFailure(listed));
        assert.strictEqual(peer.hub.calls.length, before);
        const printed = yield* peer.tests(["pass", "x"]);
        assert.strictEqual(
          printed.split("\n")[0],
          "peer: refused: tests is turned off on this environment.",
        );
      }),
    ),
  );

  it.effect("is inactive while the Hub serves no test reports", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready({ revision: null });
        assert.isFalse(yield* peer.peer.plugins.isActive("test-reports"));
      }),
    ),
  );
});
