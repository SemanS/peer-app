// @effect-diagnostics nodeBuiltinImport:off - a git repository in a temporary directory.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, assert, describe, it } from "@effect/vitest";
import type { PeerTask } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import { HerdrClient, type HerdrClientShape } from "./client/HerdrClient.ts";
import type { HerdrAgent } from "./client/herdr.ts";
import { readHerdrChangedPaths } from "./client/observations.ts";
import { prepareHerdrTaskWorktree } from "./client/worktree.ts";
import type { HerdrAgents, HerdrAgentState } from "./follower.ts";
import { makeLauncher } from "./launcher.ts";
import { HerdrRuntime } from "./runtime.ts";

/** Temporary directories a test made, removed when it ends, even by failing. */
const removed: Array<string> = [];
afterEach(() => {
  for (const directory of removed.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

describe("task worktree", () => {
  it("creates a feature branch for the issue and observes only the agent's checkout", async () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-task-"));
    removed.push(directory);
    const checkout = NodePath.join(directory, "checkout");
    NodeFS.mkdirSync(checkout);
    const git = (...args: string[]) =>
      NodeChildProcess.execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8" });
    git("init", "-b", "main");
    NodeFS.writeFileSync(NodePath.join(checkout, "base.ts"), "base\n");
    git("add", ".");
    git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base");
    NodeFS.writeFileSync(NodePath.join(checkout, "base.ts"), "person's work\n");
    const tree = await prepareHerdrTaskWorktree({
      checkout,
      baseBranch: "main",
      worktrees: NodePath.join(directory, "trees"),
      task: "KRK-812",
    });
    assert.match(tree.branch, /^feature\/KRK-812-[a-f0-9]{8}$/);
    assert.strictEqual(NodeFS.readFileSync(NodePath.join(tree.cwd, "base.ts"), "utf8"), "base\n");
    assert.deepStrictEqual(await readHerdrChangedPaths(tree.cwd), []);
    NodeFS.writeFileSync(NodePath.join(tree.cwd, "a b.ts"), "agent's work\n");
    assert.deepStrictEqual(await readHerdrChangedPaths(tree.cwd), ["a b.ts"]);
    assert.strictEqual(
      NodeFS.readFileSync(NodePath.join(checkout, "base.ts"), "utf8"),
      "person's work\n",
    );
  });

  it("makes a jj workspace with the bookmark on its change in a colocated jj repository", async () => {
    const directory = NodeFS.realpathSync(
      NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-task-jj-")),
    );
    removed.push(directory);
    const checkout = NodePath.join(directory, "checkout");
    NodeFS.mkdirSync(checkout);
    const env = { ...process.env, JJ_USER: "Test", JJ_EMAIL: "test@example.com" };
    const git = (...args: string[]) =>
      NodeChildProcess.execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8" });
    const jj = (cwd: string, ...args: string[]) =>
      NodeChildProcess.execFileSync("jj", ["--quiet", "--no-pager", ...args], {
        cwd,
        env,
        encoding: "utf8",
      });
    git("init", "-b", "main");
    NodeFS.writeFileSync(NodePath.join(checkout, "base.ts"), "base\n");
    git("add", ".");
    git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base");
    jj(checkout, "git", "init", "--colocate");
    NodeFS.writeFileSync(NodePath.join(checkout, "base.ts"), "person's work\n");
    const tree = await prepareHerdrTaskWorktree({
      checkout,
      baseBranch: "main",
      worktrees: NodePath.join(directory, "trees"),
      task: "KRK-1",
    });
    assert.strictEqual(tree.vcs, "jj");
    assert.match(tree.branch, /^feature\/KRK-1-[a-f0-9]{8}$/);
    assert.strictEqual(NodeFS.readFileSync(NodePath.join(tree.cwd, "base.ts"), "utf8"), "base\n");
    // A jj workspace, never a Git worktree of its own branch.
    assert.isTrue(NodeFS.statSync(NodePath.join(tree.cwd, ".jj")).isDirectory());
    assert.notInclude(git("worktree", "list", "--porcelain"), `branch refs/heads/${tree.branch}`);
    assert.include(jj(checkout, "workspace", "list"), NodePath.basename(tree.cwd));
    jj(tree.cwd, "status");
    assert.strictEqual(
      jj(
        tree.cwd,
        "log",
        "--no-graph",
        "-r",
        "@",
        "-T",
        "local_bookmarks.map(|b| b.name())",
      ).trim(),
      tree.branch,
    );
    assert.strictEqual(
      NodeFS.readFileSync(NodePath.join(checkout, "base.ts"), "utf8"),
      "person's work\n",
    );
  });

  it("forgets a jj workspace it could not make whole", async () => {
    const directory = NodeFS.realpathSync(
      NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-task-jj-")),
    );
    removed.push(directory);
    const checkout = NodePath.join(directory, "checkout");
    NodeFS.mkdirSync(checkout);
    NodeChildProcess.execFileSync("jj", ["--quiet", "git", "init", "--colocate"], {
      cwd: checkout,
    });
    const worktrees = NodePath.join(directory, "trees");
    // No bookmark `trunk` here or on a remote: the base does not resolve.
    const failed = await prepareHerdrTaskWorktree({
      checkout,
      baseBranch: "trunk",
      worktrees,
      task: "KRK-2",
    }).then(
      () => false,
      () => true,
    );
    assert.isTrue(failed);
    assert.deepStrictEqual(NodeFS.readdirSync(worktrees), []);
    assert.notInclude(
      NodeChildProcess.execFileSync("jj", ["workspace", "list"], {
        cwd: checkout,
        encoding: "utf8",
      }),
      "KRK-2",
    );
  });
});

describe("a launch that goes on in a checkout a run left", () => {
  const agentIn = (cwd: string): HerdrAgentState =>
    ({
      paneId: "w1:p1",
      terminalId: "t1",
      name: "peer-1",
      agent: "claude",
      status: "idle",
      title: "claude",
      branch: undefined,
      cwd,
    }) as HerdrAgentState;

  const launching = (listed: ReadonlyArray<HerdrAgentState>, started: HerdrAgentState) => {
    const folders: Array<string> = [];
    let current = listed;
    const client = {
      start: async (input: { readonly cwd: string }) => {
        folders.push(input.cwd);
        current = [started];
        return { paneId: "w1:p1", terminalId: "t1" };
      },
      prompt: async () => undefined,
    } as unknown as HerdrClientShape;
    const agents = {
      current: () => current,
      keyOf: (one: HerdrAgent) => `herdr:${one.terminalId}`,
      refresh: Effect.void,
    } as unknown as HerdrAgents;
    return Effect.map(
      makeLauncher(agents).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(HerdrClient, client),
            Layer.succeed(HerdrRuntime, {
              blocker: Effect.succeed(null),
            } as unknown as HerdrRuntime["Service"]),
          ),
        ),
      ),
      (launcher) => ({ launcher, folders }),
    );
  };

  const asked = (directory: string, reuse: string) => ({
    // Neither exists: making a checkout would fail, so a launch that passes made none.
    checkout: NodePath.join(directory, "no-repository"),
    worktrees: NodePath.join(directory, "no-trees"),
    baseBranch: "main",
    task: { id: "task", key: "KRK-1" } as PeerTask,
    harness: "claude" as const,
    prompt: "Go on.",
    env: {},
    reuse,
  });

  it.effect("starts its agent there, and says it made no checkout", () =>
    Effect.gen(function* () {
      const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-reuse-"));
      removed.push(directory);
      const { launcher, folders } = yield* launching([], agentIn(directory));
      const started = yield* launcher.launch(asked(directory, directory));
      assert.deepStrictEqual(folders, [directory]);
      assert.strictEqual(started.root, directory);
      assert.isUndefined(started.worktree);
    }).pipe(Effect.scoped),
  );

  it.effect("refuses while herdr lists an agent there, and starts nothing", () =>
    Effect.gen(function* () {
      const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-reuse-"));
      removed.push(directory);
      const open = agentIn(directory);
      const { launcher, folders } = yield* launching([open], open);
      const refused = yield* launcher.launch(asked(directory, directory)).pipe(Effect.flip);
      assert.include(refused.detail, "still open");
      assert.deepStrictEqual(folders, []);
    }).pipe(Effect.scoped),
  );
});

describe("an agent that asks to trust its folder", () => {
  it.effect("keeps its prompt until the person trusts it, and counts as waiting meanwhile", () =>
    Effect.gen(function* () {
      const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-trust-"));
      removed.push(directory);
      const checkout = NodePath.join(directory, "checkout");
      NodeFS.mkdirSync(checkout);
      const git = (...args: string[]) =>
        NodeChildProcess.execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8" });
      git("init", "-b", "main");
      NodeFS.writeFileSync(NodePath.join(checkout, "base.ts"), "base\n");
      git("add", ".");
      git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base");

      const agent: HerdrAgentState = {
        paneId: "w1:p1",
        terminalId: "t1",
        name: "peer-1",
        agent: "claude",
        status: "blocked",
        title: "claude",
        branch: undefined,
      } as HerdrAgentState;
      let current: ReadonlyArray<HerdrAgentState> = [agent];
      const typed: Array<string> = [];
      const client = {
        start: async () => ({ paneId: "w1:p1", terminalId: "t1" }),
        screen: async () =>
          "one you trust?\n\n ❯ No, exit\n   Yes, I trust this folder\n\n Enter to confirm",
        prompt: async (_target: string, text: string) => void typed.push(text),
      } as unknown as HerdrClientShape;
      const agents = {
        current: () => current,
        keyOf: (one: HerdrAgent) => `herdr:${one.terminalId}`,
        refresh: Effect.void,
      } as unknown as HerdrAgents;
      const launcher = yield* makeLauncher(agents).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(HerdrClient, client),
            Layer.succeed(HerdrRuntime, {
              blocker: Effect.succeed(null),
            } as unknown as HerdrRuntime["Service"]),
          ),
        ),
      );

      const started = yield* launcher.launch({
        checkout,
        baseBranch: "main",
        worktrees: NodePath.join(directory, "trees"),
        task: { id: "task", key: "KRK-1" } as PeerTask,
        harness: "claude",
        prompt: "The first prompt.",
        env: {},
      });
      assert.isUndefined(started.promptError);
      assert.deepStrictEqual(typed, []);
      assert.isTrue(launcher.waiting(["herdr:t1"]));

      yield* launcher.answered("t1", true);
      current = [{ ...agent, status: "idle" }];
      assert.isTrue(launcher.waiting(["herdr:t1"]));
      yield* TestClock.adjust("1 second");
      yield* Effect.promise(() => new Promise((resolve) => setImmediate(resolve)));
      assert.deepStrictEqual(typed, ["The first prompt."]);
      yield* TestClock.adjust("31 seconds");
      assert.isFalse(launcher.waiting(["herdr:t1"]));
    }).pipe(Effect.scoped),
  );
});

describe("an agent still open after Peer restarted", () => {
  const agent = (status: string) =>
    ({ terminalId: "t7", paneId: "w2:pE", status, agent: "claude" }) as unknown as HerdrAgentState;
  const of = (listed: ReadonlyArray<HerdrAgentState>) => {
    const typed: Array<string> = [];
    const client = {
      prompt: async (target: string, text: string) => void typed.push(`${target}: ${text}`),
    } as unknown as HerdrClientShape;
    const agents = {
      current: () => listed,
      keyOf: (one: HerdrAgent) => `herdr:claude:${one.terminalId}-session`,
      refresh: Effect.void,
    } as unknown as HerdrAgents;
    return Effect.map(
      makeLauncher(agents).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(HerdrClient, client),
            Layer.succeed(HerdrRuntime, {
              blocker: Effect.succeed(null),
            } as unknown as HerdrRuntime["Service"]),
          ),
        ),
      ),
      (launcher) => ({ launcher, typed }),
    );
  };
  const asked = { keys: ["herdr:claude:t7-session"], pane: undefined, prompt: "Go on." };

  it.effect("types into the idle agent of the run", () =>
    Effect.gen(function* () {
      const { launcher, typed } = yield* of([agent("idle")]);
      assert.deepStrictEqual(yield* launcher.continueOpen(asked), { open: true });
      assert.deepStrictEqual(typed, ["w2:pE: Go on."]);
    }).pipe(Effect.scoped),
  );

  it.effect("finds it by its pane when herdr no longer names its session", () =>
    Effect.gen(function* () {
      const { launcher, typed } = yield* of([agent("done")]);
      const found = yield* launcher.continueOpen({ ...asked, keys: [], pane: "w2:pE" });
      assert.deepStrictEqual(found, { open: true });
      assert.strictEqual(typed.length, 1);
    }).pipe(Effect.scoped),
  );

  it.effect("types nothing into an agent that waits on its person, and says so", () =>
    Effect.gen(function* () {
      const { launcher, typed } = yield* of([agent("blocked")]);
      const found = yield* launcher.continueOpen(asked);
      assert.isTrue(found.open);
      assert.isString(found.refused);
      assert.deepStrictEqual(typed, []);
    }).pipe(Effect.scoped),
  );

  it.effect("says none is open when the run has no agent here", () =>
    Effect.gen(function* () {
      const { launcher } = yield* of([agent("idle")]);
      const found = yield* launcher.continueOpen({ ...asked, keys: ["herdr:other"] });
      assert.deepStrictEqual(found, { open: false });
    }).pipe(Effect.scoped),
  );
});
