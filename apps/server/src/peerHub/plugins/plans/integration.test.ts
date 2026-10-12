// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - isolated broker, native stand-in Hub and fixture state.
import * as NodeFSP from "node:fs/promises";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { PeerPlan, PeerPlanRelation, PeerPlansView } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { brokerFixture, pluginsOf } from "../../core/broker/testkit.ts";
import { PeerAgents } from "../../core/coordination/PeerAgents.ts";
import { CliError, render } from "../../core/plugin.ts";
import { PeerHubClient } from "../../core/hub/PeerHubClient.ts";
import { PeerPlugins, startPlugins } from "../../core/plugins/PeerPlugins.ts";
import { PeerStatus } from "../../core/status/PeerStatus.ts";
import { coreLayer, meAnswer, paymentsSeed, seedState, standInHub } from "../../core/testkit.ts";
import { plan, relation, side } from "./fixtures.test.ts";
import { PlansPlugin } from "./index.ts";
import { START_LINE } from "./text.ts";

const WHEN = "2026-10-12T20:00:00Z";
const ana = (task = "krk-1") => side("claude:one", task, "ana@acme.test", "ana-laptop");
const bob = side("codex:b", "krk-2", "bob@acme.test", "bob-mac");
const carol = side("claude:c", "krk-3", "carol@acme.test", "carol-mac");
const meets = (id: string, over: Partial<PeerPlanRelation>): PeerPlanRelation =>
  relation(id, { project: "app", ...over });
/** Ana's agent uses what Bob's changes. */
const R1 = meets("r1", { a: ana(), b: bob, contract: "takes cents, returns cents" });
/** Ana's agent and Carol's change the same function. */
const R2 = meets("r2", {
  kind: "same-change",
  a: ana(),
  b: carol,
  item: { path: "src/ledger.ts", name: "post" },
});
/** Bob's agent uses what Ana's changes. */
const R3 = meets("r3", {
  a: bob,
  b: ana(),
  item: { path: "src/refund.ts", name: "refundCents" },
});

/** What the log must not hold: paths, symbols, contracts and names. */
const CONTENT = [
  "src/tax.ts",
  "src/refund.ts",
  "src/ledger.ts",
  "applyTax",
  "refundCents",
  "takes cents",
  "Bob",
  "Carol",
];

/**
 * What the Peer Mod posts when a session leaves plan mode: the fields `claudeMod/smokeCli.ts
 * --plan-mode` saw the real Mod send to the broker for ExitPlanMode with Claude Code 2.1.296, which
 * names the tool in `tool_name` and sends no input.
 */
const EXIT_PLAN_MODE = {
  tool_name: "ExitPlanMode",
  tool_input: {},
  tool_response: { filePath: "/plans/refund.md", isAgent: false, plan: "Change src/refund.ts." },
  tool_use_id: "toolu_exit",
  permission_mode: "plan",
  duration_ms: 3,
};

/** What a command that fails says, as the agent reads it. */
const failure = (run: () => Promise<string>) =>
  Effect.promise(() =>
    run().then(
      () => "did not fail",
      (error: unknown) => (error instanceof CliError ? render(error) : String(error)),
    ),
  );

/** The text an answer of the hook adds to the agent's context. */
const heard = (answer: Record<string, unknown> | null) =>
  ((answer?.hookSpecificOutput as { additionalContext?: string } | undefined)?.additionalContext ??
    "") + "";

/**
 * Ana's `claude:one` in a checkout of acme's `app`, the real plans plugin on a core whose Hub says
 * what `shown` holds, and the real broker between them.
 */
const rig = Effect.gen(function* () {
  const shown: { relations: PeerPlanRelation[]; plans: PeerPlan[] } = { relations: [], plans: [] };
  const own = plan({ project: "app", session: "claude:one", email: "ana@acme.test" });
  const view = (): PeerPlansView => ({
    plans: [{ ...own, environment: "ana-laptop" }, ...shown.plans],
    relations: shown.relations,
    omitted: 0,
    at: WHEN,
  });
  const hub = yield* standInHub({
    current: (url) =>
      url === "/v1/me"
        ? [200, meAnswer({ plans: 1 })]
        : url.endsWith("/plans/withdraw")
          ? [200, { withdrawn: 1, at: WHEN }]
          : url.endsWith("/plans/app")
            ? [
                200,
                {
                  plan: { ...own, environment: "ana-laptop" },
                  relations: shown.relations,
                  omitted: 0,
                  changed: true,
                  at: WHEN,
                },
              ]
            : url.endsWith("/plans")
              ? [200, view()]
              : [200, {}],
  });
  const core = yield* Layer.build(
    coreLayer(yield* seedState(paymentsSeed(hub.url)), {
      session: "phs_test",
      plugins: [PlansPlugin],
    }),
  );
  yield* (yield* PeerHubClient.pipe(Effect.provide(core))).me;
  const status = yield* PeerStatus.pipe(Effect.provide(core));
  yield* status.coordinationFrom(() =>
    Effect.succeed({
      enabled: false,
      policy: "coordinate",
      claudeHooks: false,
      logPath: "/isolated",
      sessions: [],
      overlaps: [],
      findings: [],
      contexts: [],
      candidates: [],
    }),
  );
  const plugins = yield* PeerPlugins.pipe(Effect.provide(core));
  const installed = pluginsOf(plugins);
  const fixture = yield* Effect.acquireRelease(
    Effect.promise(() => brokerFixture(() => installed)),
    (f) => Effect.promise(f.dispose),
  );
  yield* (yield* PeerAgents.pipe(Effect.provide(core))).attach(fixture.broker);
  yield* startPlugins.pipe(Effect.provide(core));
  const contribution = (yield* plugins.active)[0]!.contributions;
  const rpc = contribution.rpc!.handlers({
    effect: (_name, effect) => effect,
    stream: (_name, stream) => stream,
  }) as Record<string, (input: unknown) => Effect.Effect<unknown>>;
  const hook = (
    id: string,
    event = "UserPromptSubmit",
    extra: Record<string, unknown> = {},
    adapter: "mod" | "hooks" = "mod",
  ) =>
    Effect.promise(() =>
      fixture.broker.hook(
        { session_id: id, cwd: fixture.root, hook_event_name: event, prompt: "Go", ...extra },
        { "x-peer-agent": "claude", "x-peer-adapter": adapter },
      ),
    );
  const cli = (args: ReadonlyArray<string>, headers: Record<string, string>) =>
    Effect.promise(() => fixture.broker.runCli("plan", args, headers));
  const asOne = { "x-peer-session": "claude:one" };
  /** Reads the Hub's view of the workspace, as a ping of the Hub makes the plugin do. */
  const refresh = rpc["peer.plans.list"]!({ workspace: "acme" });
  return { hub, shown, fixture, plugins, status, contribution, rpc, hook, cli, asOne, refresh };
});

describe("plans through the real plugin and broker", () => {
  it.effect(
    "starts with one line, tells each relation once, never wakes an idle agent and tells again after a compaction",
    () =>
      Effect.gen(function* () {
        const { shown, fixture, hook, refresh, plugins } = yield* rig;
        const started = yield* hook("one", "SessionStart", { source: "startup" });
        assert.include(heard(started), START_LINE);
        assert.isAtMost(START_LINE.length, 300);
        shown.relations = [R1];
        yield* refresh;
        const first = heard(yield* hook("one"));
        assert.include(first, "plans to change applyTax (src/tax.ts)");
        assert.include(first, "takes cents, returns cents");
        assert.notInclude(heard(yield* hook("one")), "applyTax");
        // A relation arriving while the agent is idle is not news that wakes it.
        shown.relations = [R1, R2, R3];
        yield* refresh;
        const one = fixture.broker.sessions.get("claude:one")!;
        one.status = "idle";
        assert.isNull(
          yield* Effect.promise(async () =>
            fixture.broker.wakingNews(one, await fixture.broker.plugins()),
          ),
        );
        const next = heard(yield* hook("one"));
        assert.include(next, "src/ledger.ts");
        assert.include(next, "refundCents");
        assert.notInclude(next, "takes cents");
        assert.notInclude(heard(yield* hook("one")), "ledger");
        // The conversation is compacted: what it knew of is said once more.
        yield* hook("one", "SessionStart", { source: "compact" });
        const again = heard(yield* hook("one"));
        assert.include(again, "applyTax");
        assert.include(again, "src/ledger.ts");
        assert.notInclude(heard(yield* hook("one")), "applyTax");
        assert.isTrue((yield* plugins.active).some((entry) => entry.id === "plans"));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "lets `peer plan` declare, read and withdraw as the session and read as a person, and tells a relation the answer held once",
    () =>
      Effect.gen(function* () {
        const { hub, shown, fixture, hook, cli, asOne, refresh } = yield* rig;
        yield* hook("one", "SessionStart", { source: "startup" });
        shown.relations = [R1];
        const answer = yield* cli(["--change", "src/refund.ts", "--uses", "src/tax.ts"], asOne);
        assert.include(answer, "applyTax");
        const put = hub.calls.find((call) => call.url?.endsWith("/plans/app"));
        assert.strictEqual(put?.method, "PUT");
        const body = JSON.parse(put?.body ?? "{}") as Record<string, unknown>;
        assert.strictEqual(body.session, "claude:one");
        assert.strictEqual(body.environment, "ana-laptop");
        assert.strictEqual(body.mode, "replace");
        assert.deepStrictEqual(body.changes, [{ path: "src/refund.ts" }]);
        assert.deepStrictEqual(body.uses, [{ path: "src/tax.ts" }]);
        // The declaration's answer already told the relation: the next step repeats nothing.
        yield* refresh;
        assert.notInclude(heard(yield* hook("one")), "applyTax");
        assert.include(yield* cli([], asOne), "applyTax");
        // A person's read from the shell names the project's live plans, never an agent's own view.
        const asPerson = yield* cli([], { "x-peer-cwd": fixture.root });
        assert.include(asPerson, "app");
        const refused = yield* failure(() =>
          fixture.broker.runCli("plan", ["--change", "src/refund.ts"], {
            "x-peer-cwd": fixture.root,
          }),
        );
        assert.include(refused, "does not come from an agent session");
        assert.include(yield* cli(["--withdraw"], asOne), "Plan withdrawn");
        const post = hub.calls.find((call) => call.url?.endsWith("/plans/withdraw"));
        assert.deepStrictEqual(JSON.parse(post?.body ?? "{}"), {
          environment: "ana-laptop",
          session: "claude:one",
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "reminds a Mod session that leaves plan mode once, and a plain hooks session never",
    () =>
      Effect.gen(function* () {
        const { hook } = yield* rig;
        const left = (id: string, adapter: "mod" | "hooks") =>
          hook(id, "PostToolUse", EXIT_PLAN_MODE, adapter);
        yield* hook("two", "SessionStart", { source: "startup" });
        yield* hook("three", "SessionStart", { source: "startup" }, "hooks");
        assert.include(heard(yield* left("two", "mod")), "You left plan mode without a plan");
        assert.notInclude(heard(yield* left("two", "mod")), "plan mode");
        assert.notInclude(heard(yield* left("three", "hooks")), "plan mode");
        // Other tools are not the end of a plan.
        assert.notInclude(
          heard(yield* hook("two", "PostToolUse", { tool_name: "Read", tool_input: {} })),
          "plan mode",
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "withdraws the plan when the session ends, and every plan of the computer when plans are turned off",
    () =>
      Effect.gen(function* () {
        const { hub, shown, fixture, plugins, status, hook, cli, asOne, refresh } = yield* rig;
        yield* hook("one", "SessionStart", { source: "startup" });
        shown.relations = [R1];
        yield* cli(["--change", "src/refund.ts"], asOne);
        yield* hook("one", "SessionEnd");
        const withdrawals = () =>
          hub.calls
            .filter((call) => call.url?.endsWith("/plans/withdraw"))
            .map((call) => JSON.parse(call.body) as Record<string, unknown>);
        assert.deepStrictEqual(withdrawals(), [
          { environment: "ana-laptop", session: "claude:one" },
        ]);
        // A session that never declared has nothing to withdraw when it ends.
        yield* hook("two", "SessionStart", { source: "startup" });
        yield* hook("two", "SessionEnd");
        assert.lengthOf(withdrawals(), 1);
        yield* refresh;
        yield* plugins.setPlugin({ id: "plans", enabled: false });
        assert.deepStrictEqual(withdrawals().at(-1), { environment: "ana-laptop" });
        assert.isUndefined((yield* status.publish).plans);
        assert.notInclude(heard(yield* hook("one")), "applyTax");
        const off = yield* failure(() =>
          fixture.broker.runCli("plan", [], { "x-peer-session": "claude:one" }),
        );
        assert.include(off, "turned off");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "writes counts and classes to the log, never a path, a symbol, a contract or a name",
    () =>
      Effect.gen(function* () {
        const { shown, fixture, hook, cli, asOne, refresh } = yield* rig;
        yield* hook("one", "SessionStart", { source: "startup" });
        shown.relations = [R1];
        yield* cli(["--change", "src/refund.ts", "--uses", "src/tax.ts"], asOne);
        // The declaration's answer told R1; R3 arrives later and is told at the next step.
        shown.relations = [R1, R3];
        yield* refresh;
        assert.include(heard(yield* hook("one")), "refundCents");
        yield* hook("two", "SessionStart", { source: "startup" });
        yield* hook("two", "PostToolUse", EXIT_PLAN_MODE);
        yield* cli(["--withdraw"], asOne);
        yield* Effect.promise(() => fixture.broker.host.log.idle());
        const logged = yield* Effect.promise(() =>
          NodeFSP.readFile(fixture.broker.host.logPath, "utf8"),
        );
        for (const event of ["plans.declared", "plans.told", "plans.nudged", "plans.withdrawn"])
          assert.include(logged, `"event":"${event}"`);
        for (const content of CONTENT) assert.notInclude(logged, content);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("shows the plan and what meets it on peer status", () =>
    Effect.gen(function* () {
      const { shown, fixture, hook, refresh, asOne } = yield* rig;
      const status = Effect.promise(() => fixture.broker.runCli("status", [], asOne));
      yield* hook("one", "SessionStart", { source: "startup" });
      // The view is read: the plan is there, and nothing meets it yet.
      yield* refresh;
      assert.include(
        yield* status,
        "Plan v2: 1 change, 1 maybe, 1 use, 1 contract; no relations. peer plan shows them.",
      );
      shown.relations = [R1, R2];
      yield* refresh;
      assert.include(yield* status, "; 2 relations. peer plan shows them.");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "gives an MCP session its relations in the answer of peer_plan, and not again at its steps",
    () =>
      Effect.gen(function* () {
        const { shown, fixture, refresh, contribution } = yield* rig;
        assert.deepStrictEqual(
          contribution.agentTools?.map((tool) => tool.name),
          ["peer_plan"],
        );
        shown.plans = [
          plan({
            project: "app",
            session: "claude:m1",
            email: "ana@acme.test",
            environment: "ana-laptop",
          }),
        ];
        shown.relations = [
          meets("r4", {
            kind: "same-change",
            a: side("claude:m1", "krk-4", "ana@acme.test", "ana-laptop"),
            b: carol,
            item: { path: "src/ledger.ts", name: "post" },
          }),
        ];
        yield* Effect.promise(() =>
          fixture.broker.createSession(
            "claude",
            { session_id: "m1", cwd: fixture.root },
            undefined,
            "mcp",
            "peer:thread",
          ),
        );
        yield* refresh;
        const call = (command: string, args: ReadonlyArray<string>) =>
          Effect.promise(() => fixture.broker.callTools("claude:m1", command, args, false));
        const times = (text: string, item: string) => text.split(item).length - 1;
        // The answer says it each time it is asked; the notices that follow it say nothing of it.
        for (const args of [[], [], ["--change", "src/refund.ts"]]) {
          const reply = yield* call("plan", args);
          assert.isFalse(reply.isError);
          assert.strictEqual(times(reply.text, "post (src/ledger.ts)"), 1, reply.text);
        }
        // A relation that arrives later waits for the next peer_plan: no other tool's reply carries it.
        shown.relations = [
          ...shown.relations,
          meets("r5", {
            a: side("claude:m1", "krk-4", "ana@acme.test", "ana-laptop"),
            b: bob,
            item: { path: "src/audit.ts", name: "record" },
          }),
        ];
        yield* refresh;
        assert.notInclude((yield* call("status", [])).text, "src/audit.ts");
        assert.strictEqual(times((yield* call("plan", [])).text, "record (src/audit.ts)"), 1);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("is listed in peer help and peer plan --help, with every flag of its form", () =>
    Effect.gen(function* () {
      const { fixture, asOne } = yield* rig;
      const help = yield* Effect.promise(() => fixture.broker.runCli("help", [], {}));
      assert.strictEqual(
        yield* Effect.promise(() => fixture.broker.runCli("plan", ["--help"], asOne)),
        help,
      );
      const line = help.split("\n").find((row) => row.startsWith("  peer plan "));
      for (const flag of ["--amend", "--change", "--maybe", "--uses", "--provides", "--withdraw"])
        assert.include(line, flag);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
