// @effect-diagnostics nodeBuiltinImport:off - seeds and reads peer-hub.json in a temporary state directory.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../../../config.ts";
import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as PeerState from "./PeerState.ts";

/** peer-hub.json as a Peer from before plugins wrote it: one line of JSON and a newline. */
const BEFORE_PLUGINS = `${[
  '{"hubUrl":"https://hub.acme.test","email":"ana@acme.test",',
  '"pendingSignIn":null,"workspaces":[{"slug":"acme","name":"Acme",',
  '"role":"member","allowedDomains":["acme.test"],"manifest":{"version":2,',
  '"workspace":{"slug":"acme","name":"Acme","currency":"EUR",',
  '"revision":"registry@4f2a"},"member":{"email":"ana@acme.test",',
  '"name":"Ana","role":"member"},"knowledge":{"company":{"repository":"git@github.com:acme/knowledge.git",',
  '"branch":"main","store":"kontext"}},"projects":[{"id":"pay",',
  '"name":"Payments","role":"lead","members":[{"email":"ana@acme.test",',
  '"name":"Ana"},{"email":"bob@acme.test","name":"Bob"}],"areas":["Checkout"],',
  '"repositories":[{"id":"app","url":"git@github.com:acme/pay.git",',
  '"branch":"main"}],"knowledge":{"kontext":true,"company":false},',
  '"tools":[],"capacity":{"personal":"any","personalHarnesses":["claude"],',
  '"shared":{"pool":"acme-ai","gatewayUrl":"https://gateway.acme.test",',
  '"models":[{"id":"claude-sonnet","harness":["claude"]}],',
  '"budget":{"amount":200,"period":"month","currency":"EUR"},',
  '"use":["on-demand"]}}}]},"lastSyncAt":"2026-10-08T09:00:00.000Z"}],',
  '"joinable":[{"slug":"acme-labs","name":"Acme Labs","allowedDomains":["acme.test"],',
  '"reason":"domain"}],"lastSyncAt":"2026-10-08T09:00:00.000Z",',
  '"sharedInstances":{"acme/pay":["peer-acme-pay-claude"]},',
  '"leftWorkspaces":{"ana@acme.test":["old-team"]},"assignments":{"peer:thread-1":{"workspace":"acme",',
  '"project":"pay","task":"krk-812"}},"localCheckouts":{"acme/pay/app":"/Users/ana/code/pay"},',
  '"coordination":{"enabled":true,"policy":"coordinate"},"sharedThreads":["peer:thread-1"]}',
].join("")}\n`;

const environment = Layer.mock(ServerEnvironment.ServerEnvironment)({
  getEnvironmentId: Effect.succeed(EnvironmentId.make("ana-laptop")),
});

/** A PeerState as Peer starts it on the state under `baseDir`. */
const startState = (baseDir: string) =>
  PeerState.PeerState.pipe(
    Effect.provide(
      PeerState.layer.pipe(
        Layer.provide(Layer.merge(ServerConfig.layerTest(process.cwd(), baseDir), environment)),
      ),
    ),
  );

const stateFile = (baseDir: string) => NodePath.join(baseDir, "userdata", "peer-hub.json");

/** A fresh state directory holding `seed` as peer-hub.json. */
const seeded = (seed: string) =>
  Effect.gen(function* () {
    const baseDir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({
      prefix: "peer-state-",
    });
    yield* Effect.promise(async () => {
      await NodeFSP.mkdir(NodePath.dirname(stateFile(baseDir)), { recursive: true });
      await NodeFSP.writeFile(stateFile(baseDir), seed);
    });
    return baseDir;
  });

const readFile = (path: string) => Effect.promise(() => NodeFSP.readFile(path, "utf8"));

const CapacityData = Schema.Struct({ revoked: Schema.Array(Schema.String) });

describe("PeerState", () => {
  it.effect("loads and saves a peer-hub.json from before plugins unchanged", () =>
    Effect.gen(function* () {
      const baseDir = yield* seeded(BEFORE_PLUGINS);
      const state = yield* startState(baseDir);
      const { persisted } = yield* state.read;
      assert.strictEqual(yield* state.email, "ana@acme.test");
      assert.deepStrictEqual(persisted.sharedThreads, ["peer:thread-1"]);
      assert.isUndefined(persisted.plugins);
      assert.isUndefined(persisted.pluginData);

      yield* state.updatePersisted((current) => current);
      assert.strictEqual(yield* readFile(stateFile(baseDir)), BEFORE_PLUGINS);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps plugin choices and plugin data across a restart", () =>
    Effect.gen(function* () {
      const baseDir = yield* seeded(BEFORE_PLUGINS);
      const first = yield* startState(baseDir);
      yield* first.updatePersisted((persisted) => ({
        ...persisted,
        plugins: { find: false, memory: true },
      }));
      yield* first.pluginData("capacity", CapacityData).update((current) => {
        assert.isTrue(Option.isNone(current));
        return { revoked: ["acme/pay"] };
      });

      const restarted = yield* startState(baseDir);
      const persisted = (yield* restarted.read).persisted;
      assert.deepStrictEqual(persisted.plugins, { find: false, memory: true });
      assert.deepStrictEqual(
        yield* restarted.pluginData("capacity", CapacityData).read,
        Option.some({ revoked: ["acme/pay"] }),
      );
      // A slice that no longer decodes reads as none, and nothing else is lost.
      assert.isTrue(
        Option.isNone(
          yield* restarted.pluginData("capacity", Schema.Struct({ n: Schema.Number })).read,
        ),
      );
      assert.deepStrictEqual(persisted.sharedThreads, ["peer:thread-1"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("starts empty without a peer-hub.json, or with one it cannot read", () =>
    Effect.gen(function* () {
      for (const seed of ["", "{not json", '{"hubUrl":1}']) {
        const state = yield* startState(yield* seeded(seed));
        assert.deepStrictEqual((yield* state.read).persisted, PeerState.EMPTY_PERSISTED);
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("places checkouts and finds the project a path belongs to", () =>
    Effect.gen(function* () {
      const state = yield* startState(yield* seeded(BEFORE_PLUGINS));
      const { persisted } = yield* state.read;
      assert.strictEqual(
        state.checkoutPath(persisted, "acme", "pay", "app"),
        "/Users/ana/code/pay",
      );
      assert.strictEqual(
        state.checkoutPath(persisted, "acme", "pay", "docs"),
        NodePath.join(state.workspaceRoot, "acme", "pay", "docs"),
      );
      assert.deepStrictEqual(state.projectOfPath(persisted, "/Users/ana/code/pay/src/pay.ts"), {
        workspace: "acme",
        projectId: "pay",
        repositoryId: "app",
      });
      assert.isUndefined(state.projectOfPath(persisted, "/Users/ana/code/payments"));

      assert.strictEqual((yield* state.project("acme", "pay")).project.name, "Payments");
      const missing = yield* state.project("acme", "site").pipe(Effect.result);
      assert.isTrue(
        Result.isFailure(missing) && missing.failure.detail === 'Acme gives you no project "site".',
      );
      const outside = yield* state.project("globex", "pay").pipe(Effect.result);
      assert.isTrue(
        Result.isFailure(outside) &&
          outside.failure.detail === 'You are not a member of the workspace "globex".',
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "places a session in a jj workspace without a Git worktree on its repository's project",
    () =>
      Effect.gen(function* () {
        const dir = yield* Effect.promise(async () =>
          NodeFSP.realpath(await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-jj-place-"))),
        );
        const checkout = NodePath.join(dir, "pay");
        const workspace = NodePath.join(dir, "pay-krk-1");
        const outside = NodePath.join(dir, "elsewhere");
        const sh = (cwd: string, command: string, ...args: string[]) =>
          NodeChildProcess.execFileSync(command, args, { cwd, stdio: "ignore" });
        yield* Effect.promise(async () => {
          await NodeFSP.mkdir(checkout);
          await NodeFSP.mkdir(outside);
        });
        sh(checkout, "git", "init", "-q", "-b", "main");
        sh(checkout, "jj", "git", "init", "--colocate", "--quiet");
        sh(checkout, "jj", "workspace", "add", "--no-colocate", "--quiet", workspace);
        const state = yield* startState(
          yield* seeded(BEFORE_PLUGINS.replace("/Users/ana/code/pay", checkout)),
        );
        assert.deepStrictEqual(yield* state.placeOf(workspace), {
          workspace: "acme",
          project: "pay",
          root: workspace,
          repositoryId: "app",
        });
        assert.isNull(yield* state.placeOf(outside));
        yield* Effect.promise(() => NodeFSP.rm(dir, { recursive: true, force: true }));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  /** A fresh clone (a repository with an origin and no commits) under a temporary directory. */
  const clone = (origin: string) =>
    Effect.promise(async () => {
      const dir = await NodeFSP.realpath(
        await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-clone-")),
      );
      const root = NodePath.join(dir, "pay");
      await NodeFSP.mkdir(root);
      NodeChildProcess.execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
      NodeChildProcess.execFileSync("git", ["remote", "add", "origin", origin], { cwd: root });
      await NodeFSP.mkdir(NodePath.join(root, "src"));
      return { dir, root };
    });

  it.effect("a_fresh_clone_is_bound_by_its_remote", () =>
    Effect.gen(function* () {
      const { dir, root } = yield* clone("https://github.com/acme/pay");
      const baseDir = yield* seeded(BEFORE_PLUGINS);
      const state = yield* startState(baseDir);
      assert.deepStrictEqual(yield* state.placeOf(NodePath.join(root, "src")), {
        workspace: "acme",
        project: "pay",
        root,
        repositoryId: "app",
      });
      assert.strictEqual(yield* state.pendingBindingNotice(), `Bound ${root} to acme/pay.`);
      // Said once; the binding stands and survives a restart.
      assert.isNull(yield* state.pendingBindingNotice());
      assert.strictEqual((yield* state.placeOf(root))?.project, "pay");
      assert.isNull(yield* state.pendingBindingNotice());
      const restarted = yield* startState(baseDir);
      assert.strictEqual((yield* restarted.read).persisted.localCheckouts?.["acme/pay/app"], root);
      yield* Effect.promise(() => NodeFSP.rm(dir, { recursive: true, force: true }));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("two_projects_with_one_url_bind_nothing", () =>
    Effect.gen(function* () {
      const { dir, root } = yield* clone("git@github.com:acme/pay.git");
      const seed = JSON.parse(BEFORE_PLUGINS);
      const projects = seed.workspaces[0].manifest.projects;
      projects.push({ ...projects[0], id: "pay-eu", name: "Payments EU" });
      const state = yield* startState(yield* seeded(`${JSON.stringify(seed)}\n`));
      assert.isNull(yield* state.placeOf(root));
      const notice = yield* state.pendingBindingNotice();
      assert.include(notice ?? "", "acme/pay, acme/pay-eu");
      assert.include(notice ?? "", "peer core bind . --project <workspace/project>");
      assert.isUndefined((yield* state.read).persisted.localCheckouts?.["acme/pay-eu/app"]);
      assert.strictEqual(
        (yield* state.read).persisted.localCheckouts?.["acme/pay/app"],
        "/Users/ana/code/pay",
      );
      yield* Effect.promise(() => NodeFSP.rm(dir, { recursive: true, force: true }));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("an_unknown_remote_is_unshared", () =>
    Effect.gen(function* () {
      const { dir, root } = yield* clone("git@github.com:someone/else.git");
      const state = yield* startState(yield* seeded(BEFORE_PLUGINS));
      assert.isNull(yield* state.placeOf(root));
      assert.isNull(yield* state.pendingBindingNotice());
      // Nor does a caller that may not write bind a clone that matches.
      const other = yield* clone("git@github.com:acme/pay.git");
      assert.isNull(yield* state.placeOf(other.root, { bindByRemote: false }));
      assert.isNull(yield* state.pendingBindingNotice());
      for (const made of [dir, other.dir])
        yield* Effect.promise(() => NodeFSP.rm(made, { recursive: true, force: true }));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
