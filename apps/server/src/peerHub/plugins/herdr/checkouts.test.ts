// @effect-diagnostics nodeBuiltinImport:off - a workspace checkout made with git in a temporary directory.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { vi } from "vite-plus/test";

import { coreLayer, paymentsSeed, paymentsT3, seedState, standInHub } from "../../core/testkit.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import { makeTaskCheckouts } from "./checkouts.ts";
import type { HerdrAgent } from "./client/herdr.ts";
import { prepareHerdrTaskWorktree } from "./client/worktree.ts";
import type { HerdrAgents } from "./follower.ts";

afterEach(() => vi.unstubAllEnvs());

/** acme's Payments with task KRK-1 in `status`. */
const work = (status: "open" | "done") => ({
  projects: {
    pay: {
      areas: [],
      tasks: [
        {
          id: "krk-1",
          key: "KRK-1",
          title: "Split payments",
          status,
          createdBy: "ana@acme.test",
          createdAt: "2026-10-08T10:00:00Z",
          updatedAt: "2026-10-08T10:00:00Z",
        },
      ],
      threads: [],
    },
  },
});

const git = (cwd: string, ...args: Array<string>) =>
  NodeChildProcess.execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Ana",
      GIT_AUTHOR_EMAIL: "ana@acme.test",
      GIT_COMMITTER_NAME: "Ana",
      GIT_COMMITTER_EMAIL: "ana@acme.test",
    },
  });

describe("a task checkout herdr's launcher made", () => {
  it.effect(
    "stays while its task is open or an agent runs in it, and goes once neither holds",
    () =>
      Effect.gen(function* () {
        // Ana's Payments checkout, cloned from an origin whose main has one commit.
        const root = NodeFS.realpathSync(
          yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({
            prefix: "peer-herdr-checkouts-",
          }),
        );
        vi.stubEnv("PEER_WORKSPACE", root);
        const origin = NodePath.join(root, "origin.git");
        git(root, "init", "--quiet", "--bare", "--initial-branch=main", origin);
        const seed = NodePath.join(root, "seed");
        git(root, "clone", "--quiet", origin, seed);
        NodeFS.writeFileSync(NodePath.join(seed, "README.md"), "Payments\n");
        git(seed, "add", "README.md");
        git(seed, "commit", "--quiet", "-m", "start");
        git(seed, "push", "--quiet", "origin", "HEAD:main");
        const checkout = NodePath.join(root, "acme", "pay", "api");
        git(root, "clone", "--quiet", origin, checkout);

        const answer = { current: work("open") };
        const hub = yield* standInHub({
          current: (url) =>
            url === "/v1/workspaces/acme/work" ? [200, answer.current] : [200, {}],
        });
        const core = yield* Layer.build(
          coreLayer(yield* seedState(paymentsSeed(hub.url)), {
            session: "phs_test",
            t3: paymentsT3,
          }),
        );
        const running: { current: ReadonlyArray<HerdrAgent> | null } = { current: [] };
        const agents = { current: () => running.current } as unknown as HerdrAgents;
        const { created, look, noteOf } = yield* makeTaskCheckouts(agents).pipe(
          Effect.provide(core),
        );
        const readWork = PeerWork.PeerWork.use((one) => one.readWork("acme")).pipe(
          Effect.provide(core),
        );
        yield* readWork;

        const tree = yield* Effect.promise(() =>
          prepareHerdrTaskWorktree({
            checkout,
            baseBranch: "main",
            worktrees: NodePath.join(root, ".worktrees", "acme", "pay", "api"),
            task: "KRK-1",
          }),
        );
        const stat = NodeFS.statSync(tree.cwd);
        yield* created({
          kind: "task-worktree-created",
          workspace: "acme",
          project: "pay",
          repository: "api",
          task: "krk-1",
          thread: "herdr:t2",
          root: tree.cwd,
          identity: `${stat.dev}:${stat.ino}`,
        });
        running.current = [
          {
            terminalId: "t2",
            paneId: "w2:p1",
            agent: "codex",
            title: "Split payments",
            status: "done",
            completionSeq: 1,
            cwd: NodePath.join(tree.cwd, "src"),
            session: undefined,
          },
        ];

        // Open task: nothing happens and the agent's row says nothing.
        yield* look.pipe(Effect.provide(core));
        assert.isTrue(NodeFS.existsSync(tree.cwd));
        assert.isUndefined(noteOf(tree.cwd));

        // Done, but the agent still runs in it: it stays, and the row says when it goes.
        answer.current = work("done");
        yield* readWork;
        yield* look.pipe(Effect.provide(core));
        assert.isTrue(NodeFS.existsSync(tree.cwd));
        assert.strictEqual(
          noteOf(NodePath.join(tree.cwd, "src")),
          "Its task is done: Peer removes this checkout once the agent is closed.",
        );

        // Unsaved work: the row says why it stays.
        NodeFS.writeFileSync(NodePath.join(tree.cwd, "pay.ts"), "split\n");
        yield* look.pipe(Effect.provide(core));
        assert.strictEqual(
          noteOf(tree.cwd),
          "Peer keeps this checkout: it has 1 uncommitted change.",
        );

        // The agent closed, its work unsaved: it stays.
        running.current = [];
        yield* look.pipe(Effect.provide(core));
        assert.isTrue(NodeFS.existsSync(NodePath.join(tree.cwd, "pay.ts")));

        // While herdr cannot be read, Peer cannot tell that no agent runs there: it touches nothing.
        NodeFS.rmSync(NodePath.join(tree.cwd, "pay.ts"));
        running.current = null;
        yield* look.pipe(Effect.provide(core));
        assert.isTrue(NodeFS.existsSync(tree.cwd));

        // An agent whose folder herdr does not say could be working in it: it touches nothing.
        running.current = [
          {
            terminalId: "t3",
            paneId: "w3:p1",
            agent: "claude",
            title: "Somewhere",
            status: "working",
            completionSeq: undefined,
            cwd: undefined,
            session: undefined,
          },
        ];
        yield* look.pipe(Effect.provide(core));
        assert.isTrue(NodeFS.existsSync(tree.cwd));

        // Clean, pushed, no agent: removed, and forgotten.
        running.current = [];
        yield* look.pipe(Effect.provide(core));
        assert.isFalse(NodeFS.existsSync(tree.cwd));
        assert.isUndefined(noteOf(tree.cwd));
        yield* look.pipe(Effect.provide(core));
        assert.isTrue(NodeFS.existsSync(checkout), "the person's checkout stays");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
