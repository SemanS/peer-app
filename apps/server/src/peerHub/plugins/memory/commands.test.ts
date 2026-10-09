import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import type { PeerHubStatus } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";

import { brokerFixture, pluginsOf } from "../../core/broker/testkit.ts";
import type { PeerCommand, PeerSessionView } from "../../core/plugin.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import { coreLayer, meAnswer, seedState, signedInSeed, standInHub } from "../../core/testkit.ts";
import { memoryCommands } from "./commands.ts";
import { makeMemoryPlugin } from "./index.ts";
import type * as MemoryCli from "./MemoryCli.ts";
import type * as MemoryService from "./MemoryService.ts";
import { MemoryError } from "./MemoryTransport.ts";

const coordination: PeerHubStatus["coordination"] = {
  enabled: false,
  policy: "coordinate",
  claudeHooks: false,
  logPath: "/tmp/coordination.jsonl",
  sessions: [],
  overlaps: [],
  findings: [],
  contexts: [],
  candidates: [],
};

/** Ana's Peer, signed in to `hub`, with memory included in the build and started. */
const anaWithMemory = (hub: { readonly url: string }) =>
  Effect.gen(function* () {
    const core = yield* Layer.build(
      coreLayer(yield* seedState(signedInSeed(hub.url)), {
        session: "phs_test",
        plugins: [makeMemoryPlugin({ available: true })],
      }),
    );
    return yield* Effect.gen(function* () {
      yield* (yield* PeerStatus.PeerStatus).setFacadeParts(() => Effect.succeed({ coordination }));
      yield* PeerPlugins.startPlugins;
      return yield* PeerPlugins.PeerPlugins;
    }).pipe(Effect.provide(core));
  });

/** A broker in acme's app checkout with Ana's Claude Code session, running memory's commands. */
const brokerOver = (plugins: PeerPlugins.PeerPlugins["Service"]) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const fixture = await brokerFixture(() => pluginsOf(plugins));
      await fixture.register("memory-one");
      return fixture;
    }),
    (fixture) => Effect.promise(() => fixture.dispose()),
  );

const SESSION = { "x-peer-session": "claude:memory-one" };

describe("peer memory and peer remember", () => {
  it.effect("are refused in one line, ask the Hub nothing and leave help while memory is off", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub({ current: () => [200, meAnswer()] });
      const fixture = yield* brokerOver(yield* anaWithMemory(hub));
      const run = (command: string, args: ReadonlyArray<string>) =>
        Effect.promise(() =>
          fixture.broker["runCli"](command, args, SESSION).then(
            () => null,
            (error: { readonly status: number; readonly message: string }) => error,
          ),
        );
      assert.deepInclude(yield* run("memory", ["status"]), {
        status: 409,
        message: "peer: memory is turned off on this environment.",
      });
      assert.deepInclude(yield* run("remember", ["--claim", "x", "--evidence", "a.ts:1"]), {
        status: 409,
        message: "peer: remember is turned off on this environment.",
      });
      const help = yield* Effect.promise(() => fixture.broker["runCli"]("help", [], {}));
      assert.notInclude(help, "peer memory");
      assert.notInclude(help, "peer remember");
      assert.isFalse(hub.calls.some((call) => call.url?.includes("/memory") === true));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("are listed in help and run for the calling session while memory is on", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub({ current: () => [200, meAnswer()] });
      const plugins = yield* anaWithMemory(hub);
      yield* plugins.setPlugin({ id: "memory", enabled: true });
      const fixture = yield* brokerOver(plugins);
      const help = (yield* Effect.promise(() => fixture.broker["runCli"]("help", [], {}))).split(
        "\n",
      );
      assert.deepStrictEqual(help.slice(-2), [
        "  peer memory <search|read|project|notice|...>  your project's durable shared memory; peer memory help lists what it does",
        '  peer remember --claim "<finding>" [--evidence <path:line>]  a durable finding for your project\'s memory',
      ]);
      // An action memory does not know answers what it does, without asking the Hub.
      assert.include(
        yield* Effect.promise(() => fixture.broker["runCli"]("memory", ["help"], SESSION)),
        "peer remember --claim <finding>",
      );
      assert.isFalse(hub.calls.some((call) => call.url?.includes("/memory") === true));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

/** Ana's Claude Code session on task krk-1 in Peer's thread-1, as plugins see it. */
const view: PeerSessionView = {
  id: "claude:native-1",
  agent: "claude",
  adapter: "hooks",
  runtimeGeneration: "generation-1",
  workspace: "acme",
  project: "app",
  repositoryId: "api",
  root: "/checkouts/acme/app/api",
  cwd: "/checkouts/acme/app/api",
  task: "krk-1",
  thread: "peer:thread-1",
  pane: undefined,
  status: "working",
  keeps: false,
  files: [],
  claims: [],
  local: (_plugin, init) => init(),
};

/** The commands over a memory CLI that answers `answer`, writing down what it was asked. */
const commandsOver = (answer: Effect.Effect<string, MemoryError>) => {
  const asked: Array<{
    readonly session: MemoryService.MemorySession;
    readonly command: string;
    readonly args: ReadonlyArray<string>;
  }> = [];
  const synced: Array<string> = [];
  const cli: MemoryCli.MemoryCli["Service"] = {
    run: (session, command, args) =>
      Effect.sync(() => asked.push({ session, command, args })).pipe(Effect.andThen(answer)),
  };
  const sync = (workspace: string) => Effect.sync(() => void synced.push(workspace));
  const [memory, remember] = memoryCommands({ cli, sync, environmentId: "ana-laptop" }) as [
    PeerCommand,
    PeerCommand,
  ];
  const input = (args: ReadonlyArray<string>) => ({
    session: view,
    args,
    plain: args,
    text: args.join(" "),
    flag: () => undefined,
    cwd: view.cwd,
  });
  return { memory, remember, input, asked, synced };
};

describe("memory's commands", () => {
  it.effect("act as the calling session once the Hub has heard of it", () =>
    Effect.gen(function* () {
      const test = commandsOver(Effect.succeed("stored"));
      assert.strictEqual(
        yield* test.remember.run(test.input(["--claim", "Prices are in cents"])),
        "stored",
      );
      assert.deepStrictEqual(test.synced, ["acme"]);
      assert.deepStrictEqual(test.asked, [
        {
          session: {
            workspace: "acme",
            project: "app",
            sessionId: "claude:native-1",
            environmentId: "ana-laptop",
            runtimeGeneration: "generation-1",
            workId: "peer:thread-1",
            taskId: "krk-1",
            repositoryId: "api",
            adapter: "claude",
            root: "/checkouts/acme/app/api",
          },
          command: "remember",
          args: ["--claim", "Prices are in cents"],
        },
      ]);
    }),
  );

  it.effect("answer each kind of failure with the status the peer shim reports", () =>
    Effect.gen(function* () {
      const outcomes = [];
      for (const code of [
        "invalid",
        "refused",
        "not_found",
        "conflict",
        "unavailable",
        "local",
      ] as const) {
        const test = commandsOver(Effect.fail(new MemoryError({ code, detail: `It is ${code}.` })));
        const answer = yield* test.memory
          .run(test.input(["read", "assertion-1"]))
          .pipe(Effect.result);
        assert.isTrue(Result.isFailure(answer));
        if (Result.isFailure(answer))
          outcomes.push([answer.failure.status, answer.failure.message]);
      }
      expect(outcomes).toEqual([
        [400, "peer: It is invalid."],
        [409, "peer: It is refused."],
        [409, "peer: It is not_found."],
        [409, "peer: It is conflict."],
        [409, "peer: It is unavailable. Nothing changed; try again once the Hub answers."],
        [500, "peer: It is local."],
      ]);
    }),
  );
});
