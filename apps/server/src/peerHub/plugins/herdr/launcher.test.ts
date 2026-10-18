// @effect-diagnostics nodeBuiltinImport:off - a git repository in a temporary directory.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, assert, describe, it } from "@effect/vitest";

import { readHerdrChangedPaths } from "./client/observations.ts";
import { prepareHerdrTaskWorktree } from "./client/worktree.ts";

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
