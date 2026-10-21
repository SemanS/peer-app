// @effect-diagnostics nodeBuiltinImport:off - isolated filesystem fixtures.
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { type PeerHubStartAgentInput, type PeerHubError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import {
  bindPlugin,
  type PeerRequestAcceptor,
  type PeerTaskLauncher,
  type PeerLifecycleEvent,
} from "../plugin.ts";
import * as PeerPlugins from "../plugins/PeerPlugins.ts";
import * as PeerWork from "./PeerWork.ts";
import * as PeerStatus from "../status/PeerStatus.ts";
import { coreLayer, paymentsSeed, seedState, standInHub } from "../testkit.ts";
import { startAgent } from "./start.ts";
const input: PeerHubStartAgentInput = {
  workspace: "acme",
  projectId: "pay",
  taskId: "krk-1",
  repositoryId: "api",
  harness: "codex",
};
const program = (
  check: (fixture: {
    start: (input: PeerHubStartAgentInput) => Effect.Effect<unknown, PeerHubError>;
    accepted: Array<Parameters<PeerRequestAcceptor["accept"]>[0]>;
    launched: Array<Parameters<PeerTaskLauncher["launch"]>[0]>;
    plugins: PeerPlugins.PeerPlugins["Service"];
    unavailable: { current: string | null };
    task: { status: string };
    read: Effect.Effect<void, PeerHubError>;
    created: Array<PeerLifecycleEvent>;
    worktree: { current: string | undefined };
  }) => Effect.Effect<void, PeerHubError>,
) =>
  Effect.gen(function* () {
    const created: Array<PeerLifecycleEvent> = [],
      worktree: { current: string | undefined } = { current: undefined };
    const accepted: Array<Parameters<PeerRequestAcceptor["accept"]>[0]> = [],
      launched: Array<Parameters<PeerTaskLauncher["launch"]>[0]> = [];
    const unavailable: { current: string | null } = { current: null },
      task = {
        id: "krk-1",
        key: "KRK-1",
        title: "Split payments",
        status: "open",
        createdBy: "ana@acme.test",
        createdAt: "2026-10-09",
        updatedAt: "2026-10-09",
      };
    const requests = bindPlugin({
      id: "requests",
      title: "Team requests",
      summary: "test",
      defaultEnabled: true,
      layer: Layer.empty,
      make: Effect.succeed({
        taskWorktreeCreated: (event) =>
          Effect.sync(() => {
            created.push(event);
          }),
        requestAcceptor: {
          accept: (asked) =>
            Effect.sync(() => {
              accepted.push(asked);
              return { prompt: `${asked.instruction ?? asked.fallback}\nFenced request data` };
            }),
        },
      }),
    });
    const herdr = bindPlugin({
      id: "herdr",
      title: "herdr",
      summary: "test",
      defaultEnabled: true,
      layer: Layer.empty,
      make: Effect.succeed({
        taskLauncher: {
          unavailable: Effect.sync(() => unavailable.current),
          launch: (asked) =>
            Effect.sync(() => {
              launched.push(asked);
              return {
                paneId: "pane",
                terminalId: "term",
                threadKey: "herdr:term",
                ...(worktree.current === undefined
                  ? {}
                  : {
                      worktree: {
                        root: NodePath.isAbsolute(worktree.current)
                          ? worktree.current
                          : NodePath.join(asked.worktrees, worktree.current),
                        identity: "dev:inode",
                      },
                    }),
              };
            }),
        },
      }),
    });
    const hub = yield* standInHub({
      current: (url) =>
        url.endsWith("/work")
          ? [200, { projects: { pay: { areas: [], tasks: [task], threads: [] } } }]
          : [200, {}],
    });
    const core = yield* Layer.build(
      coreLayer(yield* seedState(paymentsSeed(hub.url)), {
        session: "person",
        plugins: [requests, herdr],
      }),
    );
    const status = yield* PeerStatus.PeerStatus.pipe(Effect.provide(core));
    yield* status.coordinationFrom(() =>
      Effect.succeed({
        enabled: false,
        policy: "coordinate",
        claudeHooks: false,
        logPath: "/tmp/test",
        sessions: [],
        overlaps: [],
        findings: [],
        contexts: [],
        candidates: [],
      }),
    );
    const plugins = yield* PeerPlugins.PeerPlugins.pipe(Effect.provide(core));
    yield* PeerPlugins.startPlugins.pipe(Effect.provide(core));
    const work = yield* PeerWork.PeerWork.pipe(Effect.provide(core));
    const read = work.readWork("acme");
    yield* read;
    yield* check({
      start: (asked) => startAgent(asked).pipe(Effect.provide(core)),
      accepted,
      launched,
      plugins,
      unavailable,
      task,
      read,
      created,
      worktree,
    });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));
describe("request launch ordering", () => {
  it.effect(
    "forwards the reviewed ordinary prompt exactly and keeps blank-only service fallback",
    () =>
      program((f) =>
        Effect.gen(function* () {
          const prompt = "\n  Preserve the reviewed task instructions.\n\n";
          yield* f.start({ ...input, prompt });
          assert.equal(f.launched[0]!.prompt, prompt);
          yield* f.start({ ...input, prompt: " \n\t " });
          assert.isTrue(f.launched[1]!.prompt.startsWith("KRK-1: Split payments."));
        }),
      ),
  );
  it.effect(
    "only grants background worktree provenance for a launch inside the selected task repository",
    () =>
      program((f) =>
        Effect.gen(function* () {
          yield* f.start(input);
          assert.deepStrictEqual(f.created, []);
          f.worktree.current = "/other/checkout";
          yield* f.start(input);
          assert.deepStrictEqual(f.created, []);
          f.worktree.current = "created";
          yield* f.start(input);
          assert.deepStrictEqual(f.created, [
            {
              kind: "task-worktree-created",
              workspace: "acme",
              project: "pay",
              repository: "api",
              task: "krk-1",
              thread: "herdr:term",
              root: NodePath.join(f.launched.at(-1)!.worktrees, "created"),
              identity: "dev:inode",
            },
          ]);
        }),
      ),
  );
  it.effect("uses the acceptor prompt for old and new clients and keeps ordinary starts", () =>
    program((f) =>
      Effect.gen(function* () {
        yield* f.start({ ...input, requestId: "one", prompt: "UNTRUSTED EDITED CLIENT TEXT" });
        assert.isTrue(f.launched[0]!.prompt.startsWith("KRK-1: Split payments."));
        assert.notInclude(f.launched[0]!.prompt, "UNTRUSTED");
        assert.include(f.launched[0]!.prompt, "Fenced request data");
        yield* f.start({
          ...input,
          requestId: "two",
          instruction: "My own instruction",
          prompt: "UNTRUSTED",
        });
        assert.isTrue(f.launched[1]!.prompt.startsWith("My own instruction"));
        yield* f.start({ ...input, prompt: "Ordinary start" });
        assert.equal(f.launched[2]!.prompt, "Ordinary start");
        yield* f.start(input);
        assert.isTrue(f.launched[3]!.prompt.startsWith("KRK-1: Split payments."));
        assert.equal(f.accepted.length, 2);
      }),
    ),
  );
  it.effect("does not accept anything after local failure or with requests disabled", () =>
    program((f) =>
      Effect.gen(function* () {
        const asked = { ...input, requestId: "one" };
        f.unavailable.current = "herdr not running";
        assert.isTrue(Result.isFailure(yield* f.start(asked).pipe(Effect.result)));
        f.unavailable.current = null;
        assert.isTrue(
          Result.isFailure(
            yield* f.start({ ...asked, repositoryId: "missing" }).pipe(Effect.result),
          ),
        );
        f.task.status = "done";
        yield* f.read;
        assert.isTrue(Result.isFailure(yield* f.start(asked).pipe(Effect.result)));
        f.task.status = "open";
        yield* f.read;
        yield* f.plugins.setPlugin({ id: "requests", enabled: false });
        assert.isTrue(Result.isFailure(yield* f.start(asked).pipe(Effect.result)));
        assert.deepStrictEqual(f.accepted, []);
        assert.deepStrictEqual(f.launched, []);
      }),
    ),
  );
});
describe("the base a launch starts from", () => {
  it.effect("passes a chosen base to the launcher and keeps the repository's otherwise", () =>
    program((f) =>
      Effect.gen(function* () {
        yield* f.start(input);
        yield* f.start({ ...input, baseBranch: "feature/ORD-11-cents" });
        assert.notStrictEqual(f.launched[0]!.baseBranch, "feature/ORD-11-cents");
        assert.strictEqual(f.launched[1]!.baseBranch, "feature/ORD-11-cents");
      }),
    ),
  );
  it.effect("refuses an unsafe ref before anything launches", () =>
    program((f) =>
      Effect.gen(function* () {
        for (const baseBranch of ["--upload-pack=x", "a..b", "x y"]) {
          assert.isTrue(
            Result.isFailure(yield* f.start({ ...input, baseBranch }).pipe(Effect.result)),
          );
        }
        assert.deepStrictEqual(f.launched, []);
      }),
    ),
  );
});
