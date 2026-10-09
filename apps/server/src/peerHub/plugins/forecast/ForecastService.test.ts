import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/unstable/process";
import type { PeerForecast } from "@t3tools/contracts";
import { PeerState } from "../../core/state/PeerState.ts";
import { coreLayer, paymentsSeed, seedState } from "../../core/testkit.ts";
import { VcsProcess, type VcsProcessInput } from "../../../vcs/VcsProcess.ts";
import { createGit } from "./git.ts";
import { makeForecast } from "./ForecastService.ts";
const branch = (i: number) => `feature/${i}`,
  oid = (i: number) => i.toString(16).padStart(40, "0");
const setup = (count = 8, forcedOff = false, version = "2.50.1") =>
  Effect.gen(function* () {
    const core = yield* Layer.build(
      coreLayer(yield* seedState(paymentsSeed("https://hub.invalid"))),
    );
    const state = Context.get(core, PeerState),
      calls: VcsProcessInput[] = [];
    const mergeStarted = yield* Queue.unbounded<void>();
    let failedFetch = false,
      revision = 0,
      mergeMs = 0;
    const vcs = VcsProcess.of({
      run: (input) =>
        Effect.sync(() => {
          calls.push(input);
          const stdout = input.args.includes("--version")
            ? `git version ${version}`
            : input.args[0] === "rev-parse"
              ? "/fake/common\n/fake/common/objects\n"
              : input.args.includes("for-each-ref")
                ? input.args
                    .filter((v) => v.startsWith("refs/"))
                    .map(
                      (ref) =>
                        `${oid(Number(ref.split("/").at(-1)) + (ref.endsWith("/0") ? revision * 10 : 0))} ${ref}`,
                    )
                    .join("\n")
                : input.args.includes("merge-tree")
                  ? `${oid(999)}\0pay.txt\0\0`
                  : "";
          return {
            exitCode: ChildProcessSpawner.ExitCode(
              input.args.includes("merge-tree") || (input.args.includes("fetch") && failedFetch)
                ? 1
                : 0,
            ),
            stdout,
            stderr: "",
            stdoutTruncated: false,
            stderrTruncated: false,
          };
        }).pipe(
          Effect.flatMap((answer) =>
            input.args.includes("merge-tree")
              ? Queue.offer(mergeStarted, undefined).pipe(
                  Effect.andThen(Effect.sleep(mergeMs)),
                  Effect.as(answer),
                )
              : Effect.succeed(answer),
          ),
        ),
    });
    yield* state.updateRuntime((s) => ({
      ...s,
      localThreads: new Map([
        [
          "acme",
          Array.from({ length: count }, (_, i) => ({
            id: `peer:${i}`,
            project: "pay",
            repository: "api",
            branch: branch(i),
            title: branch(i),
            status: "working" as const,
            source: "peer" as const,
          })),
        ],
      ]),
    }));
    const forecast = yield* makeForecast(
      state,
      createGit(vcs, `${state.hubHome}/coord/forecast`),
      () => Effect.void,
      forcedOff,
    );
    return {
      forecast,
      state,
      calls,
      mergeStarted: Queue.take(mergeStarted),
      drainStarts: Queue.clear(mergeStarted),
      mergeDuration: (ms: number) => {
        mergeMs = ms;
      },
      commit: () => {
        revision++;
      },
      failFetch: () => {
        failedFetch = true;
      },
    };
  });
describe("forecast local worker", () => {
  it.effect(
    "ends a round at thirty seconds, observes the shared duty cycle and removes private scratch objects on deadline",
    () =>
      Effect.gen(function* () {
        const { forecast, calls, state, mergeDuration, mergeStarted, drainStarts } =
          yield* setup(8);
        mergeDuration(3000);
        yield* forecast.boot;
        const fiber = yield* forecast.round().pipe(Effect.forkScoped);
        yield* mergeStarted;
        yield* TestClock.adjust(30000);
        yield* Fiber.join(fiber);
        assert.strictEqual(calls.filter((c) => c.args.includes("merge-tree")).length, 3);
        assert.strictEqual(
          (yield* forecast.pairs).filter((p) => p.result === undefined).length,
          25,
        );
        const fs = yield* FileSystem.FileSystem;
        assert.deepStrictEqual(yield* fs.readDirectory(`${state.hubHome}/coord/forecast`), []);
        yield* drainStarts;
        // The next round must wait until 36s before the next process, carrying the previous duty cycle.
        const next = yield* forecast.round().pipe(Effect.forkScoped);
        yield* TestClock.adjust(5999);
        assert.strictEqual(calls.filter((c) => c.args.includes("merge-tree")).length, 3);
        yield* TestClock.adjust(1);
        yield* mergeStarted;
        yield* TestClock.adjust(24000);
        yield* Fiber.join(next);
        assert.strictEqual(calls.filter((c) => c.args.includes("merge-tree")).length, 5);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "settles changed commits after five seconds and limits explicit caller refreshes to one per thirty seconds",
    () =>
      Effect.gen(function* () {
        const { forecast, calls, commit } = yield* setup(2);
        yield* forecast.boot;
        yield* forecast.round();
        commit();
        yield* forecast.round();
        yield* TestClock.adjust(4999);
        yield* forecast.round();
        assert.strictEqual(calls.filter((c) => c.args.includes("merge-tree")).length, 1);
        yield* TestClock.adjust(1);
        yield* forecast.round();
        assert.strictEqual(calls.filter((c) => c.args.includes("merge-tree")).length, 2);
        const session = {
          id: "codex:cli",
          workspace: "acme",
          project: "pay",
          repositoryId: "api",
          branch: "feature/0",
        } as import("../../core/plugin.ts").PeerSessionView;
        commit();
        yield* forecast.refresh(session);
        commit();
        yield* forecast.refresh(session);
        assert.strictEqual(calls.filter((c) => c.args.includes("merge-tree")).length, 3);
        yield* TestClock.adjust(30000);
        yield* forecast.refresh(session);
        assert.strictEqual(calls.filter((c) => c.args.includes("merge-tree")).length, 4);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "schedules named fetches, preserves old results on failure, backs off, counts missing refs and drops remote pairs when off",
    () =>
      Effect.gen(function* () {
        const { forecast, state, calls, failFetch } = yield* setup(1);
        const row = (n: string) => ({
          id: `remote-${n}`,
          repository: "api",
          branch: `feature/${n}`,
          title: "Remote",
          email: "bob@test",
          environment: "desktop",
          seenAt: "2026-10-09T12:00:00Z",
          status: "working" as const,
          source: "peer" as const,
        });
        yield* state.updateRuntime((s) => ({
          ...s,
          work: new Map([
            ["acme/pay", { areas: [], tasks: [], threads: [row("1"), row("missing")] }],
          ]),
        }));
        yield* forecast.boot;
        yield* forecast.round();
        assert.strictEqual(calls.filter((c) => c.args.includes("fetch")).length, 0);
        yield* forecast.configure({ teammates: true });
        yield* forecast.round();
        assert.strictEqual((yield* forecast.read).pairs.length, 1);
        assert.strictEqual((yield* forecast.read).notOnOrigin, 1);
        assert.strictEqual(calls.filter((c) => c.args.includes("fetch")).length, 1);
        yield* forecast.round();
        assert.strictEqual(calls.filter((c) => c.args.includes("fetch")).length, 1);
        yield* TestClock.adjust(300000);
        failFetch();
        yield* forecast.round();
        assert.strictEqual((yield* forecast.read).pairs.length, 1);
        assert.isDefined((yield* forecast.read).fetchFailedAt);
        yield* TestClock.adjust(899999);
        yield* forecast.round();
        assert.strictEqual(calls.filter((c) => c.args.includes("fetch")).length, 2);
        yield* TestClock.adjust(1);
        yield* forecast.round();
        assert.strictEqual(calls.filter((c) => c.args.includes("fetch")).length, 3);
        yield* forecast.configure({ teammates: false });
        assert.deepStrictEqual((yield* forecast.read).pairs, []);
        assert.strictEqual((yield* forecast.read).notOnOrigin, 0);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect(
    "rejects unsupported Git before discovery and reads unchanged tips without rerunning merges",
    () =>
      Effect.gen(function* () {
        const old = yield* setup(2, false, "2.34.1");
        yield* old.forecast.boot;
        yield* old.forecast.round();
        assert.strictEqual((yield* old.forecast.read).git, "2.34.1");
        assert.strictEqual((yield* old.forecast.read).state, "unsupported");
        assert.strictEqual(old.calls.length, 1);
        const normal = yield* setup(2);
        yield* normal.forecast.boot;
        yield* normal.forecast.round();
        const before = normal.calls.length;
        for (let i = 0; i < 10; i++) yield* normal.forecast.round();
        assert.strictEqual(
          normal.calls.slice(before).filter((c) => c.args.includes("for-each-ref")).length,
          10,
        );
        assert.strictEqual(
          normal.calls.slice(before).filter((c) => c.args.includes("merge-tree")).length,
          0,
        );
        yield* normal.forecast.stop;
        const stopped = normal.calls.length;
        yield* normal.forecast.round();
        assert.strictEqual(normal.calls.length, stopped);
        yield* normal.forecast.boot;
        yield* normal.forecast.round();
        assert.strictEqual(
          normal.calls.slice(stopped).filter((c) => c.args.includes("merge-tree")).length,
          1,
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect(
    "carries a pair backlog across bounded rounds and reuses the same commits without processes",
    () =>
      Effect.gen(function* () {
        const { forecast, calls } = yield* setup();
        yield* forecast.boot;
        yield* forecast.round();
        assert.strictEqual(calls.filter((c) => c.args.includes("merge-tree")).length, 8);
        assert.strictEqual((yield* forecast.read).pairs.length, 8);
        for (let i = 0; i < 3; i++) yield* forecast.round();
        assert.strictEqual((yield* forecast.read).pairs.length, 28);
        const merges = calls.filter((c) => c.args.includes("merge-tree")).length;
        yield* forecast.round();
        assert.strictEqual(calls.filter((c) => c.args.includes("merge-tree")).length, merges);
        assert.strictEqual(calls.filter((c) => c.args.includes("fetch")).length, 0);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect(
    "enforces the environment override before any process, and forgets membership data",
    () =>
      Effect.gen(function* () {
        const forced = yield* setup(2, true);
        yield* forced.forecast.boot;
        yield* forced.forecast.round();
        assert.deepStrictEqual(forced.calls, []);
        assert.strictEqual((yield* forced.forecast.read).reason, "environment");
        const normal = yield* setup(2);
        yield* normal.forecast.boot;
        yield* normal.forecast.round();
        assert.strictEqual((yield* normal.forecast.read).pairs.length, 1);
        yield* normal.forecast.forget("acme");
        assert.deepStrictEqual((yield* normal.forecast.read).pairs, []);
        assert.deepStrictEqual(yield* normal.forecast.pairs, []);
        yield* normal.forecast.stop;
        assert.strictEqual((yield* normal.forecast.read).state, "off");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect(
    "gives the first stream value immediately, collapses a burst and suppresses identical snapshots",
    () =>
      Effect.gen(function* () {
        const { forecast } = yield* setup(2);
        const values = yield* Queue.unbounded<PeerForecast>();
        yield* forecast.changes.pipe(
          Stream.runForEach((s) => Queue.offer(values, s)),
          Effect.forkScoped,
        );
        assert.strictEqual((yield* Queue.take(values)).state, "off");
        yield* forecast.boot;
        yield* forecast.round();
        yield* TestClock.adjust(1000);
        assert.strictEqual((yield* Queue.take(values)).pairs.length, 1);
        yield* forecast.round();
        yield* TestClock.adjust(1000);
        assert.strictEqual((yield* Queue.poll(values))._tag, "None");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
