// @effect-diagnostics nodeBuiltinImport:off - real jj and git in temporary repositories; PEER_JUJUTSU is read from the environment.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { PEER_JUJUTSU_METHODS, PeerHubError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";

import { brokerFixture, pluginsOf } from "../../core/broker/testkit.ts";
import type { CliError, PeerContributions, PeerRpcWrap } from "../../core/plugin.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import { PeerState } from "../../core/state/PeerState.ts";
import { coreLayer, paymentsSeed, seedState } from "../../core/testkit.ts";
import {
  exec,
  isolatedHome,
  jj,
  repository,
  sessionIn,
  stepOf,
  workspaceConfig,
} from "./fixtures.test.ts";
import { JujutsuPlugin } from "./index.ts";

isolatedHome();

/** Bob's core with the plugin started; its contributions as the broker reads them. */
const started = Effect.gen(function* () {
  const core = yield* Layer.build(
    coreLayer(yield* seedState(paymentsSeed("https://hub.invalid")), {
      session: "phs_test",
      plugins: [JujutsuPlugin],
    }),
  );
  return yield* Effect.gen(function* () {
    const state = yield* PeerState;
    yield* state.updatePersisted((persisted) => ({ ...persisted, email: "bob@acme.test" }));
    yield* PeerPlugins.startPlugins;
    const plugins = yield* PeerPlugins.PeerPlugins;
    const contributions = (): Effect.Effect<PeerContributions | undefined> =>
      plugins.active.pipe(
        Effect.map((active) => active.find(({ id }) => id === "jujutsu")?.contributions),
      );
    return { plugins, contributions, state };
  }).pipe(Effect.provide(core));
});

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

/** `PEER_JUJUTSU` set to `value` (unset when undefined) while `effect` runs. */
const withEnvironment = <A, E, R>(value: string | undefined, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const before = process.env.PEER_JUJUTSU;
      if (value === undefined) delete process.env.PEER_JUJUTSU;
      else process.env.PEER_JUJUTSU = value;
      return before;
    }),
    () => effect,
    (before) =>
      Effect.sync(() => {
        if (before === undefined) delete process.env.PEER_JUJUTSU;
        else process.env.PEER_JUJUTSU = before;
      }),
  );

const passThrough = {
  effect: <A, E, R>(_method: string, effect: Effect.Effect<A, E, R>) => effect,
  stream: <S>(_method: string, stream: S) => stream,
} as unknown as PeerRpcWrap;

describe("the jujutsu plugin", () => {
  it("is defined as the Settings row of the design says, and needs no Hub", () => {
    assert.strictEqual(JujutsuPlugin.id, "jujutsu");
    assert.strictEqual(JujutsuPlugin.title, "Jujutsu workspaces");
    assert.isTrue(JujutsuPlugin.defaultEnabled);
    assert.isUndefined(JujutsuPlugin.hubFeature);
    assert.deepStrictEqual(JujutsuPlugin.commandNames, ["follow"]);
  });

  it.effect("is active without a Hub, and forced off by PEER_JUJUTSU=off", () =>
    withEnvironment(
      undefined,
      Effect.gen(function* () {
        const { plugins } = yield* started;
        assert.isTrue(yield* plugins.isActive("jujutsu"));
        process.env.PEER_JUJUTSU = "off";
        assert.isFalse(yield* plugins.isActive("jujutsu"));
        const state = (yield* plugins.states).find(({ id }) => id === "jujutsu");
        assert.strictEqual(state?.reason, "PEER_JUJUTSU=off");
        assert.isTrue(state?.locked);
      }).pipe(run),
    ),
  );

  it.effect("configures an agent workspace, and its owner turning it off removes the keys", () =>
    withEnvironment(
      undefined,
      Effect.gen(function* () {
        const repo = repository({ person: false });
        const bob = repo.workspace("ORD-12-3f2a1b2c");
        const { plugins, contributions } = yield* started;
        const hooks = (yield* contributions())!.hooks!;
        const session = sessionIn(bob);

        // The turn-end follow, and the one notice that may wake an idle agent.
        assert.isDefined(hooks.stop);
        assert.deepStrictEqual(
          hooks.notices!.map((notice) => notice.wakes),
          [false, true],
        );
        yield* hooks.sessionStart!({ session, event: "session-start", remainingMs: 1_000 });
        assert.include(workspaceConfig(bob), "bob·codex");
        assert.strictEqual(
          (yield* (yield* contributions())!.status!.read as Effect.Effect<{
            agentWorkspaces: number;
          }>).agentWorkspaces,
          1,
        );

        yield* plugins.setPlugin({ id: "jujutsu", enabled: false });

        assert.strictEqual(workspaceConfig(bob).trim(), "");
        assert.isUndefined(yield* contributions());
        const refused = yield* plugins.requireActive("jujutsu").pipe(
          Effect.result,
          Effect.map((result) => (Result.isFailure(result) ? result.failure.detail : "")),
        );
        assert.include(refused, "turned off");
      }).pipe(run),
    ),
  );

  it.effect("runs nothing in a Git checkout", () =>
    withEnvironment(
      undefined,
      Effect.gen(function* () {
        const repo = repository({ person: false });
        const git = NodePath.join(repo.dir, "plain");
        NodeFS.mkdirSync(git);
        exec("git", git, "init", "--quiet");
        const { contributions } = yield* started;
        const plugin = (yield* contributions())!;
        const session = sessionIn(git);
        const stop = {
          ...stepOf(session, { command: "jj --ignore-immutable squash --into lrorvllt" }),
          event: "pre-tool" as const,
        };

        yield* plugin.hooks!.sessionStart!({ session, event: "session-start", remainingMs: 1_000 });
        const noticed = yield* plugin.hooks!.postTool!(
          stepOf(session, { command: "jj squash --into lrorvllt" }),
        );

        assert.isNull(noticed);
        // No fetch, no push notice, no `peer follow`, and no method acts on it.
        const push = {
          ...stepOf(session, { command: "jj git push -b x" }),
          event: "pre-tool" as const,
        };
        assert.isNull(yield* plugin.hooks!.notices![0]!.read(push));
        const refusal = yield* plugin
          .commands![0]!.run({
            session,
            args: ["krk-2"],
            plain: ["krk-2"],
            text: "krk-2",
            flag: () => undefined,
            cwd: undefined,
          })
          .pipe(Effect.flip);
        assert.include((refusal as CliError).reason, "needs a Jujutsu checkout");
        assert.isNull(plugin.hooks!.preTool!.fallback(stop));
        assert.isNull(yield* plugin.hooks!.preTool!.decide(stop));
        assert.isFalse(NodeFS.existsSync(NodePath.join(git, ".jj")));
        assert.strictEqual(
          (yield* plugin.status!.read as Effect.Effect<{ agentWorkspaces: number }>)
            .agentWorkspaces,
          0,
        );
      }).pipe(run),
    ),
  );

  it.effect("stops --ignore-immutable in a jj checkout the same with and without its budget", () =>
    withEnvironment(
      undefined,
      Effect.gen(function* () {
        const repo = repository({ person: false });
        const bob = repo.workspace("ORD-12-3f2a1b2c");
        const { contributions } = yield* started;
        const plugin = (yield* contributions())!;
        const session = sessionIn(bob);
        yield* plugin.hooks!.sessionStart!({ session, event: "session-start", remainingMs: 1_000 });
        const stop = {
          ...stepOf(session, { command: "jj --ignore-immutable rebase -s main -o @" }),
          event: "pre-tool" as const,
        };

        const decided = yield* plugin.hooks!.preTool!.decide(stop);

        assert.strictEqual(decided?.decision, "deny");
        assert.deepStrictEqual(plugin.hooks!.preTool!.fallback(stop), decided);
        assert.strictEqual(plugin.hooks!.preTool!.on, "shell");
      }).pipe(run),
    ),
  );

  it.effect(
    "answers its configure method, and the others in words when there is no Jujutsu checkout to act on",
    () =>
      withEnvironment(
        undefined,
        Effect.gen(function* () {
          const { contributions } = yield* started;
          const plugin = (yield* contributions())!;
          const handlers = plugin.rpc!.handlers(passThrough) as Record<
            string,
            (input: unknown) => Effect.Effect<unknown, PeerHubError>
          >;
          const configured = (yield* handlers[PEER_JUJUTSU_METHODS.peerJujutsuConfigure]!({
            protection: false,
          })) as { protection: boolean };
          assert.isFalse(configured.protection);
          const place = { workspace: "acme", project: "pay" };
          const inputs: Record<string, unknown> = {
            [PEER_JUJUTSU_METHODS.peerJujutsuOperations]: place,
            [PEER_JUJUTSU_METHODS.peerJujutsuPreviewUndo]: { ...place, operation: "aaaaaaaaaaaa" },
            [PEER_JUJUTSU_METHODS.peerJujutsuUndo]: { ...place, operation: "aaaaaaaaaaaa" },
            [PEER_JUJUTSU_METHODS.peerJujutsuAtOp]: { ...place, operation: "aaaaaaaaaaaa" },
            [PEER_JUJUTSU_METHODS.peerJujutsuConverge]: { ...place, change: "kkkkkkkk" },
            [PEER_JUJUTSU_METHODS.peerJujutsuIntegrate]: {
              ...place,
              a: { task: "krk-1", rev: "feature/a" },
              b: { task: "krk-2", rev: "feature/b" },
              later: "b",
            },
          };
          for (const [method, input] of Object.entries(inputs)) {
            const answer = yield* handlers[method]!(input).pipe(Effect.result);
            assert.isTrue(Result.isFailure(answer), method);
            if (Result.isFailure(answer))
              assert.include(answer.failure.detail, "not a Jujutsu repository");
          }
          const follow = yield* handlers[PEER_JUJUTSU_METHODS.peerJujutsuFollow]!({
            ...place,
            session: "peer:nobody",
            task: "krk-2",
          }).pipe(Effect.result);
          assert.isTrue(Result.isFailure(follow));
          if (Result.isFailure(follow)) assert.include(follow.failure.detail, "not running here");
        }).pipe(run),
      ),
  );

  it.effect(
    "tells whose change a squash named after jj refused it, at the step Claude Code says failed",
    () =>
      withEnvironment(
        undefined,
        Effect.gen(function* () {
          const repo = repository({ person: false });
          const bob = repo.workspace("ORD-12-3f2a1b2c");
          const { plugins, contributions } = yield* started;
          // Ana's agent made ORD-11 in the default workspace, and its step made the change hers.
          NodeFS.writeFileSync(NodePath.join(repo.main, "order.js"), "line one\nline two\n");
          jj(repo.main, "describe", "-m", "ORD-11");
          yield* (yield* contributions())!.hooks!.postTool!(
            stepOf(sessionIn(repo.main, { id: "claude:ana", agent: "claude", task: "krk-2" })),
          );
          const anas = jj(repo.main, "log", "--no-graph", "-r", "@", "-T", "change_id").slice(0, 8);
          const fixture = yield* Effect.acquireRelease(
            Effect.promise(() =>
              brokerFixture(() => ({
                ...pluginsOf(plugins),
                placeOf: async (cwd) => ({ workspace: "acme", project: "pay", root: cwd }),
              })),
            ),
            (made) => Effect.promise(() => made.dispose()),
          );
          const hook = (event: string, more: Record<string, unknown> = {}) =>
            Effect.promise(() =>
              fixture.broker["hook"](
                { hook_event_name: event, session_id: "bob", cwd: bob, ...more },
                {},
              ),
            );
          yield* hook("SessionStart", { source: "startup" });
          NodeFS.writeFileSync(NodePath.join(bob, "order.js"), "line one\nline two edited\n");
          const command = `jj squash --into ${anas} order.js`;
          assert.throws(() => jj(bob, "squash", "--into", anas, "order.js"), /is immutable/);

          const answer = yield* hook("PostToolUseFailure", {
            tool_name: "Bash",
            tool_input: { command },
            tool_use_id: "toolu_squash",
            error: `Exit code 1\nError: Commit ${anas} is immutable`,
          });

          const said = answer?.hookSpecificOutput as
            | { readonly hookEventName?: string; readonly additionalContext?: string }
            | undefined;
          assert.strictEqual(said?.hookEventName, "PostToolUseFailure");
          assert.include(
            said?.additionalContext ?? "",
            `${anas} is Bob's change for krk-2, so jj keeps it read-only in your workspace.`,
          );
        }).pipe(run),
      ),
  );

  it.effect("names its command so a build without it refuses `peer follow`", () =>
    Effect.gen(function* () {
      const { contributions } = yield* started;
      assert.deepStrictEqual(
        (yield* contributions())!.commands!.map((command) => command.name),
        ["follow"],
      );
    }).pipe(run),
  );
});
