// @effect-diagnostics preferSchemaOverJson:off globalDate:off - the bodies the stand-in Hub was sent.
/**
 * The flow of design D4–D7 end to end through the broker test kit (task 10.1): Ana's building session
 * files a mixed report with an unowned unverified item through `peer tests`, its `peer done` meets the
 * Hub's `409 unverified_unowned` and ends refused naming the item, Ana gives the item an owner (the
 * RPC the task page calls), `peer done` goes ahead, and the handoff package carries the report into
 * the agent text and the pull request block. The stand-in Hub answers with the bodies and codes of
 * the Hub's routes (`features/test_reports/routes.rs`, `gate.rs`, `api/work.rs`, `handoff/compose.rs`),
 * as a smoke of the real Hub returned them. Then the version mix of task 10.2: against a Hub that
 * serves no test reports the plugin is inactive, `peer tests` is refused in one line, `peer done` is
 * not gated and a package without `report` says so.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  PeerHandoffPackage,
  type PeerTestReport,
  type PeerTestReportItem,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import type { PeerBrokerHost } from "../../core/broker/host.ts";
import type * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import { CliError, render } from "../../core/plugin.ts";
import { TEST_ENVIRONMENT, type HubCall } from "../../core/testkit.ts";
import { hubCalls as handoffHub } from "../handoff/hub.ts";
import { agentText, blockOf } from "../handoff/render.ts";
import { ANA, PEER_TEST_REPORTS_METHODS as methods, SLAVO, TESTS, ready } from "./fixtures.test.ts";

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const ACME = "/v1/workspaces/acme";
const TASK = `${ACME}/projects/pay/tasks/vl-7`;
const HANDOFF = `${ACME}/handoffs/pay/vl-7`;
const AT = "2026-10-27T14:03:00.000Z";
const ITEM = "iPhone layout of the task page";
const place = { workspace: "acme", project: "pay", task: "vl-7" };

/** An agent's move as Peer makes it (`PeerCoordination` `finishTask`): a PATCH naming its session. */
const movesThrough = (
  client: PeerHubClient.PeerHubClient["Service"],
  host: PeerBrokerHost,
): Partial<PeerBrokerHost> => ({
  finishTask: (workspace, project, task, session, status, op) =>
    host.run(
      client.session.pipe(
        Effect.flatMap((signedIn) =>
          client.api.updateTask(signedIn.hubUrl, signedIn.session, workspace, project, task, {
            status,
            session,
            environment: TEST_ENVIRONMENT,
            op,
          }),
        ),
      ),
    ),
});

/**
 * What the Hub keeps of VL7: its status, its newest report and how many packages it composed.
 * `serves` false is a Hub built before the feature: no report routes, no gate, no `report` field.
 */
interface Vl7 {
  status: "open" | "review" | "done";
  report: PeerTestReport | null;
  packages: number;
  readonly serves: boolean;
}

const full = (who: string) => (who.includes("@") ? who : `${who}@acme.test`);
const unownedOf = (report: PeerTestReport | null) =>
  (report?.items ?? []).filter((item) => item.kind === "unverified" && !item.owner);

/** The Hub's answer to `method` on `url` with `body`, or undefined for the fixture's own routes. */
const vl7Hub =
  (state: Vl7) =>
  (method: string, url: string, body: string): readonly [number, unknown] | undefined => {
    const sent = (body === "" ? {} : JSON.parse(body)) as Record<string, unknown>;
    if (state.serves && url === TESTS && method === "GET")
      return [200, { reports: state.report === null ? [] : [state.report] }];
    if (state.serves && url === TESTS && method === "POST") {
      // routes.rs `file`: owners completed with the domain, numbered from 1, result corrected.
      const items = (sent.items as ReadonlyArray<PeerTestReportItem>).map(({ owner, ...item }) =>
        owner === undefined ? item : { ...item, owner: full(owner) },
      );
      const kinds = new Set(items.map((item) => item.kind));
      const result = kinds.size > 1 ? "mixed" : (sent.result as PeerTestReport["result"]);
      state.report = {
        project: "pay",
        task: "vl-7",
        author: ANA,
        number: (state.report?.number ?? 0) + 1,
        result,
        summary: sent.summary as string,
        items,
        role: "author",
        at: AT,
      };
      return [
        200,
        {
          changed: true,
          corrected: result !== sent.result,
          report: { ...state.report, shortened: false },
        },
      ];
    }
    if (state.serves && url.startsWith(`${TESTS}/`) && method === "PATCH") {
      // routes.rs `set_owner`: compare-and-set on the report's number.
      if (state.report === null || sent.number !== state.report.number)
        return [
          409,
          {
            error: {
              code: "stale_report",
              message: `report ${state.report?.number ?? 0} was filed since; read it again`,
              details: { number: state.report?.number ?? 0 },
            },
          },
        ];
      const index = Number(url.split("/").at(-1));
      const owner = sent.owner as string | null;
      state.report = {
        ...state.report,
        items: state.report.items.map((item, at) => {
          if (at !== index) return item;
          const { owner: _, ...rest } = item;
          return owner === null ? rest : { ...rest, owner: full(owner) };
        }),
      };
      return [200, { changed: true, report: state.report }];
    }
    if (url === TASK && method === "PATCH") {
      // api/work.rs: an agent's move to done meets the gate of test_reports/gate.rs.
      const unowned = unownedOf(state.report);
      if (
        state.serves &&
        sent.session !== undefined &&
        sent.status === "done" &&
        unowned.length > 0
      )
        return [
          409,
          {
            error: {
              code: "unverified_unowned",
              details: { items: unowned.map((item) => item.text) },
              message: `the newest test report has unverified items without an owner: ${unowned
                .slice(0, 5)
                .map((item) => `"${item.text}"`)
                .join(
                  ", ",
                )}; give each an owner with \`peer tests … --unverified "<text> @<person>"\` or on the task page`,
            },
          },
        ];
      state.status = sent.status as Vl7["status"];
      return [
        200,
        {
          id: "vl-7",
          project: "pay",
          key: "VL7",
          title: "Task page layout",
          status: state.status,
          createdBy: ANA,
          createdAt: AT,
          updatedAt: AT,
        },
      ];
    }
    if (url === HANDOFF && method === "POST") {
      // handoff/compose.rs: the newest report's summary, only its unowned items' text.
      state.packages += 1;
      const report = state.report;
      const items = report?.items ?? [];
      const count = (kind: PeerTestReportItem["kind"]) =>
        items.filter((item) => item.kind === kind).length;
      return [
        200,
        {
          changed: true,
          package: {
            author: ANA,
            composedAt: AT,
            context: null,
            inputs: [],
            key: "VL7",
            number: state.packages,
            overlaps: [],
            project: "pay",
            pullRequests: ["https://github.com/acme/pay/pull/7"],
            source: "agent",
            task: "vl-7",
            title: "Task page layout",
            ...(state.serves && report !== null
              ? {
                  report: {
                    at: report.at,
                    author: report.author,
                    failed: count("fail"),
                    number: report.number,
                    passed: count("pass"),
                    result: report.result,
                    role: report.role,
                    unowned: unownedOf(report).map((item) => item.text),
                    unverified: count("unverified"),
                  },
                }
              : {}),
          },
        },
      ];
    }
    return undefined;
  };

/** A Hub keeping `state`, Peer as Ana over it, and `peer done` and composing as her agent does. */
const vl7 = (state: Vl7) =>
  Effect.gen(function* () {
    const hub: { calls?: ReadonlyArray<HubCall> } = {};
    const peer = yield* ready(
      {
        revision: state.serves ? 1 : null,
        route: (url) => {
          const call = hub.calls?.at(-1);
          return vl7Hub(state)(call?.method ?? "GET", url, call?.body ?? "");
        },
      },
      movesThrough,
    );
    hub.calls = peer.hub.calls;
    const done = Effect.promise(async () => {
      await peer.fixture.register("one");
      try {
        return await peer.fixture.broker["runCli"]("done", [], {
          "x-peer-session": "claude:one",
          "x-peer-cwd": peer.fixture.root,
        });
      } catch (error) {
        if (error instanceof CliError) return render(error);
        throw error;
      }
    });
    const compose = handoffHub(peer.peer.client)
      .compose(
        { workspace: "acme", projectId: "pay", taskId: "vl-7" },
        { environment: TEST_ENVIRONMENT, session: "claude:one" },
      )
      .pipe(Effect.map((answer) => answer.package));
    return { ...peer, done, compose };
  });

const views = (p: PeerHandoffPackage) => ({
  agent: agentText([p], null).split("\n"),
  block: blockOf(p, { names: () => "Ana", pointerOnly: false }).split("\n"),
});

describe("a test report from filing to done", () => {
  it.effect(
    "gates done on an unowned item until its owner is given, and travels in the package",
    () =>
      run(
        Effect.gen(function* () {
          const state: Vl7 = { status: "review", report: null, packages: 0, serves: true };
          const peer = yield* vl7(state);
          assert.isTrue(yield* peer.peer.plugins.isActive("test-reports"));

          // The building session ran its tests through the shell, then files a mixed report.
          yield* peer.ran("cargo test features::handoff");
          const filed = yield* peer.tests([
            "mixed",
            "Unit tests pass; the phone was not checked",
            "--pass",
            "cargo test features::handoff",
            "--unverified",
            ITEM,
          ]);
          assert.strictEqual(
            filed.split("\n")[0],
            `Test report 1 filed on VL7: 1 passed, 0 failed, 1 unverified (1 needs an owner: "${ITEM}").`,
          );
          assert.include(filed, "Before peer done, give each an owner");
          assert.strictEqual(state.report?.items[0]?.seen?.failed, false, "seen run by Peer");

          // The package composed now carries the report, the unowned item by its text.
          const first = views(yield* peer.compose);
          const line = `Tests: mixed · 1 passed, 0 failed, 1 unverified · needs an owner: ${ITEM}.`;
          assert.include(first.agent, line);
          assert.include(first.block, line);

          // peer done meets the Hub's gate and ends refused naming the item; VL7 stays in review.
          const refused = yield* peer.done;
          assert.match(refused, /^peer: refused: the newest test report has unverified items/);
          assert.include(refused, `"${ITEM}"`);
          assert.include(refused, "peer tests");
          assert.include(refused, "on the task page");
          assert.strictEqual(state.status, "review");

          // Ana, VL7's owner, gives the item to Slavo from the task page (the RPC its section calls).
          const stale = yield* peer.rpc[methods.peerTestsSetOwner]({
            ...place,
            author: ANA,
            index: 1,
            number: 7,
            owner: "slavo",
          });
          assert.strictEqual(stale.kind, "stale");
          const saved = yield* peer.rpc[methods.peerTestsSetOwner]({
            ...place,
            author: ANA,
            index: 1,
            number: 1,
            owner: "slavo",
          });
          assert.strictEqual(saved.kind, "saved");
          assert.strictEqual(state.report?.items[1]?.owner, SLAVO);

          // peer done goes ahead, and the next package says nobody waits for an owner.
          assert.strictEqual(
            (yield* peer.done).split("\n")[0],
            "Task moved to done with current shared input versions.",
          );
          assert.strictEqual(state.status, "done");
          const second = views(yield* peer.compose);
          assert.include(second.block, "Tests: mixed · 1 passed, 0 failed, 1 unverified.");
          assert.include(second.agent, "Tests: mixed · 1 passed, 0 failed, 1 unverified.");
        }),
      ),
  );
});

describe("the version mix (task 10.2): a Hub that serves no test reports", () => {
  it.effect(
    "leaves the plugin inactive, refuses peer tests in one line, lets done through and says no report",
    () =>
      run(
        Effect.gen(function* () {
          const state: Vl7 = { status: "review", report: null, packages: 0, serves: false };
          const peer = yield* vl7(state);
          assert.isFalse(yield* peer.peer.plugins.isActive("test-reports"));

          const printed = yield* peer.tests(["pass", "All green", "--unverified", ITEM]);
          assert.strictEqual(
            printed.split("\n")[0],
            "peer: refused: tests needs a newer Peer Hub.",
          );
          assert.isFalse(
            peer.hub.calls.some((call) => call.url?.startsWith(TESTS)),
            "the Hub heard of no report",
          );

          const p = yield* peer.compose;
          assert.isUndefined(p.report);
          assert.include(views(p).block, "No test report was filed.");
          assert.include(views(p).agent, "No test report was filed.");

          assert.strictEqual(
            (yield* peer.done).split("\n")[0],
            "Task moved to done with current shared input versions.",
          );
          assert.strictEqual(state.status, "done");
        }),
      ),
  );
});

const decodePackage = Schema.decodeUnknownSync(PeerHandoffPackage);
// The app's contract before this change is this one without `report` (git diff peer).
const decodeOlderPackage = Schema.decodeUnknownSync(
  PeerHandoffPackage.mapFields(Struct.omit(["report"])),
);

describe("the version mix (task 10.2): an app from before this change and a Hub of it", () => {
  // The package a Hub of this change composed in the 10.1 smoke (`POST …/handoffs/app/krk-335`).
  const composed = {
    author: "bob@acme.test",
    composedAt: "2026-10-27T23:20:53.53179Z",
    context: null,
    inputs: [],
    key: "KRK-335",
    number: 1,
    overlaps: [],
    project: "app",
    pullRequests: ["https://github.com/acme/app/pull/7"],
    report: {
      at: "2026-10-27T23:20:53.513634Z",
      author: "bob@acme.test",
      failed: 0,
      number: 1,
      passed: 1,
      result: "mixed",
      role: "author",
      unowned: [ITEM],
      unverified: 1,
    },
    source: "agent",
    task: "krk-335",
    title: "Task page layout",
  };

  it("decodes the package with a report, and the app before it drops the field", () => {
    assert.strictEqual(decodePackage(composed).report?.number, 1);
    const read = decodeOlderPackage(composed);
    assert.notProperty(read, "report");
    assert.strictEqual(read.number, 1);
  });
});
