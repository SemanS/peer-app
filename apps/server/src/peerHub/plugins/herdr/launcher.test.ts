// @effect-diagnostics nodeBuiltinImport:off - a git repository in a temporary directory.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, assert, describe, it } from "@effect/vitest";

import { readHerdrChangedPaths } from "./follower.ts";
import { prepareHerdrTaskWorktree } from "./launcher.ts";

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
});
