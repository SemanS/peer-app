// @effect-diagnostics nodeBuiltinImport:off - git and jj repositories in a temporary directory.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, assert, describe, it } from "@effect/vitest";

import { resetVcsCaches } from "../../../core/vcs.ts";
import { checkTaskCheckout } from "./cleanup.ts";
import { prepareHerdrTaskWorktree } from "./worktree.ts";

const removed: Array<string> = [];
afterEach(() => {
  resetVcsCaches();
  for (const directory of removed.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Ana",
  GIT_AUTHOR_EMAIL: "ana@acme.test",
  GIT_COMMITTER_NAME: "Ana",
  GIT_COMMITTER_EMAIL: "ana@acme.test",
  JJ_USER: "Ana",
  JJ_EMAIL: "ana@acme.test",
};
const exec = (command: string, cwd: string, ...args: Array<string>) =>
  NodeChildProcess.execFileSync(command, args, { cwd, env: ENV, encoding: "utf8", stdio: "pipe" });
const git = (cwd: string, ...args: Array<string>) => exec("git", cwd, ...args);
const jj = (cwd: string, ...args: Array<string>) => exec("jj", cwd, ...args);

/**
 * Ana's checkout of a repository whose origin has `main` with one commit, and the folder Peer makes
 * task checkouts in. With `jj`, the checkout is a colocated jj repository.
 */
function project(vcs: "git" | "jj") {
  const directory = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-cleanup-")),
  );
  removed.push(directory);
  const origin = NodePath.join(directory, "origin.git");
  git(directory, "init", "--quiet", "--bare", "--initial-branch=main", origin);
  const seed = NodePath.join(directory, "seed");
  git(directory, "clone", "--quiet", origin, seed);
  NodeFS.writeFileSync(NodePath.join(seed, "README.md"), "Payments\n");
  NodeFS.writeFileSync(NodePath.join(seed, ".gitignore"), "node_modules/\n.env\n");
  git(seed, "add", ".");
  git(seed, "commit", "--quiet", "-m", "start");
  git(seed, "push", "--quiet", "origin", "HEAD:main");
  const checkout = NodePath.join(directory, "checkout");
  git(directory, "clone", "--quiet", origin, checkout);
  if (vcs === "jj") jj(checkout, "git", "init", "--colocate");
  return { checkout, worktrees: NodePath.join(directory, "trees") };
}

async function taskCheckout(vcs: "git" | "jj") {
  const { checkout, worktrees } = project(vcs);
  const tree = await prepareHerdrTaskWorktree({
    checkout,
    baseBranch: "main",
    worktrees,
    task: "KRK-1",
  });
  assert.strictEqual(tree.vcs, vcs);
  const stat = NodeFS.statSync(tree.cwd);
  const check = () =>
    checkTaskCheckout({
      checkout,
      worktrees,
      cwd: tree.cwd,
      identity: `${stat.dev}:${stat.ino}`,
    });
  return { checkout, worktrees, ...tree, check };
}

const reasonOf = async (check: ReturnType<typeof checkTaskCheckout>) => {
  const checked = await check;
  return checked.ok ? null : checked.reason;
};

async function removes(check: ReturnType<typeof checkTaskCheckout>) {
  const checked = await check;
  assert.isTrue(checked.ok, checked.ok ? "" : checked.reason);
  if (checked.ok) await checked.remove();
}

describe("a done task's git worktree", () => {
  it("is removed once clean with its commits pushed; its branch stays", async () => {
    const tree = await taskCheckout("git");
    NodeFS.mkdirSync(NodePath.join(tree.cwd, "node_modules", "pkg"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(tree.cwd, "node_modules", "pkg", "index.js"), "x\n");
    NodeFS.writeFileSync(NodePath.join(tree.cwd, "pay.ts"), "split\n");
    git(tree.cwd, "add", "pay.ts");
    git(tree.cwd, "commit", "--quiet", "-m", "split payments");
    assert.strictEqual(await reasonOf(tree.check()), "1 commit is on no remote branch yet");
    git(tree.cwd, "push", "--quiet", "origin", tree.branch);

    await removes(tree.check());
    assert.isFalse(NodeFS.existsSync(tree.cwd));
    assert.notInclude(git(tree.checkout, "worktree", "list"), tree.cwd);
    assert.include(git(tree.checkout, "branch", "--list", tree.branch), tree.branch);
  });

  it("stays with uncommitted, untracked or ignored files, and says which", async () => {
    const tree = await taskCheckout("git");
    NodeFS.writeFileSync(NodePath.join(tree.cwd, "README.md"), "edited\n");
    assert.strictEqual(await reasonOf(tree.check()), "it has 1 uncommitted change");
    git(tree.cwd, "checkout", "--", "README.md");
    NodeFS.writeFileSync(NodePath.join(tree.cwd, "notes.md"), "draft\n");
    assert.strictEqual(await reasonOf(tree.check()), "it has 1 uncommitted change");
    NodeFS.rmSync(NodePath.join(tree.cwd, "notes.md"));
    NodeFS.writeFileSync(NodePath.join(tree.cwd, ".env"), "TOKEN=1\n");
    assert.strictEqual(
      await reasonOf(tree.check()),
      "it holds ignored files no commit keeps (.env)",
    );
    assert.isTrue(NodeFS.existsSync(NodePath.join(tree.cwd, ".env")));
  });

  it("stays when git would refuse it: a worktree that changed after the check", async () => {
    const tree = await taskCheckout("git");
    const checked = await tree.check();
    assert.isTrue(checked.ok);
    NodeFS.writeFileSync(NodePath.join(tree.cwd, "late.ts"), "late\n");
    if (checked.ok) {
      let failed = false;
      await checked.remove().catch(() => (failed = true));
      assert.isTrue(failed);
    }
    assert.strictEqual(NodeFS.readFileSync(NodePath.join(tree.cwd, "late.ts"), "utf8"), "late\n");
  });

  it("is never the person's checkout, a folder outside Peer's, or a folder made anew", async () => {
    const tree = await taskCheckout("git");
    assert.strictEqual(
      await reasonOf(
        checkTaskCheckout({
          checkout: tree.checkout,
          worktrees: tree.worktrees,
          cwd: tree.checkout,
        }),
      ),
      "it is not a task checkout Peer made",
    );
    assert.strictEqual(
      await reasonOf(
        checkTaskCheckout({
          checkout: tree.checkout,
          worktrees: NodePath.dirname(tree.checkout),
          cwd: tree.checkout,
        }),
      ),
      "it is not a task checkout Peer made",
    );
    assert.strictEqual(
      await reasonOf(
        checkTaskCheckout({
          checkout: tree.checkout,
          worktrees: tree.worktrees,
          cwd: tree.cwd,
          identity: "0:0",
        }),
      ),
      "its folder is not the one Peer made",
    );
    assert.isTrue(NodeFS.existsSync(tree.cwd) && NodeFS.existsSync(tree.checkout));
  });

  it("keeps data in an ignored folder no build makes again, and another repository", async () => {
    const tree = await taskCheckout("git");
    NodeFS.appendFileSync(NodePath.join(tree.cwd, ".gitignore"), "data/\n.claude/\n");
    git(tree.cwd, "add", ".gitignore");
    git(tree.cwd, "commit", "--quiet", "-m", "ignore data");
    git(tree.cwd, "push", "--quiet", "origin", tree.branch);
    NodeFS.mkdirSync(NodePath.join(tree.cwd, "data"));
    NodeFS.writeFileSync(NodePath.join(tree.cwd, "data", "local.db"), "rows\n");
    assert.strictEqual(
      await reasonOf(tree.check()),
      "it holds ignored files no commit keeps (data/)",
    );
    NodeFS.rmSync(NodePath.join(tree.cwd, "data"), { recursive: true });
    // A worktree nested in an ignored folder: its own edits never show in this one's status.
    git(
      tree.checkout,
      "worktree",
      "add",
      "--quiet",
      "--detach",
      NodePath.join(tree.cwd, ".claude", "nested"),
    );
    assert.strictEqual(
      await reasonOf(tree.check()),
      "it holds ignored files no commit keeps (.claude/)",
    );
    NodeFS.mkdirSync(NodePath.join(tree.cwd, "vendor", "lib"), { recursive: true });
    git(NodePath.join(tree.cwd, "vendor", "lib"), "init", "--quiet");
    NodeFS.writeFileSync(NodePath.join(tree.cwd, "vendor", "lib", "x"), "x\n");
    assert.match(
      (await reasonOf(tree.check())) ?? "",
      /^it has \d+ uncommitted change|^it holds another repository/,
    );
  });

  it("keeps a commit only this checkout's own history reaches", async () => {
    const tree = await taskCheckout("git");
    git(tree.cwd, "checkout", "--quiet", "--detach");
    NodeFS.writeFileSync(NodePath.join(tree.cwd, "spike.ts"), "spike\n");
    git(tree.cwd, "add", "spike.ts");
    git(tree.cwd, "commit", "--quiet", "-m", "spike");
    git(tree.cwd, "checkout", "--quiet", tree.branch);
    assert.strictEqual(await reasonOf(tree.check()), "1 commit is only in this checkout's history");
  });

  it("whose folder someone removed is only forgotten; git's own records are left alone", async () => {
    const tree = await taskCheckout("git");
    NodeFS.rmSync(tree.cwd, { recursive: true, force: true });
    await removes(tree.check());
    assert.include(git(tree.checkout, "worktree", "list"), NodePath.basename(tree.cwd));
  });
});

describe("a done task's jj workspace", () => {
  it("is forgotten through jj and removed once its changes are pushed", async () => {
    const tree = await taskCheckout("jj");
    NodeFS.writeFileSync(NodePath.join(tree.cwd, "pay.ts"), "split\n");
    assert.strictEqual(await reasonOf(tree.check()), "it has changes not committed and pushed");
    jj(tree.cwd, "commit", "-m", "split payments");
    assert.strictEqual(await reasonOf(tree.check()), "1 change is on no remote bookmark yet");
    jj(tree.cwd, "git", "push", "-b", tree.branch);

    await removes(tree.check());
    assert.isFalse(NodeFS.existsSync(tree.cwd));
    const workspaces = jj(tree.checkout, "workspace", "list", "-T", 'name ++ "\\n"');
    assert.deepStrictEqual(workspaces.trim().split("\n"), ["default"]);
    assert.include(jj(tree.checkout, "bookmark", "list", tree.branch), tree.branch);
  });

  it("stays with a fresh but unsaved edit, a described change, or an ignored file", async () => {
    const tree = await taskCheckout("jj");
    assert.isNull(await reasonOf(tree.check()), "a fresh workspace holds nothing");
    jj(tree.cwd, "describe", "-m", "plan: split payments");
    assert.strictEqual(await reasonOf(tree.check()), "1 change is on no remote bookmark yet");
    jj(tree.cwd, "describe", "-m", "");
    NodeFS.writeFileSync(NodePath.join(tree.cwd, ".env"), "TOKEN=1\n");
    assert.strictEqual(
      await reasonOf(tree.check()),
      "it holds ignored files no commit keeps (.env)",
    );
    NodeFS.rmSync(NodePath.join(tree.cwd, ".env"));

    const checked = await tree.check();
    assert.isTrue(checked.ok);
    NodeFS.writeFileSync(NodePath.join(tree.cwd, "late.ts"), "late\n");
    if (checked.ok) {
      let failed = false;
      await checked.remove().catch(() => (failed = true));
      assert.isTrue(failed, "an edit made after the check stops the removal");
    }
    assert.isTrue(NodeFS.existsSync(NodePath.join(tree.cwd, "late.ts")));
    assert.include(jj(tree.checkout, "workspace", "list"), NodePath.basename(tree.cwd));
  });

  it("is never the repository's default workspace", async () => {
    const tree = await taskCheckout("jj");
    assert.strictEqual(
      await reasonOf(
        checkTaskCheckout({
          checkout: tree.checkout,
          worktrees: tree.worktrees,
          cwd: tree.checkout,
        }),
      ),
      "it is not a task checkout Peer made",
    );
  });

  it("keeps a file jj refused to snapshot", async () => {
    const tree = await taskCheckout("jj");
    NodeFS.writeFileSync(NodePath.join(tree.cwd, "fixture.bin"), Buffer.alloc(2 * 1024 * 1024, 1));
    assert.strictEqual(await reasonOf(tree.check()), "it has files jj does not track");
    assert.isTrue(NodeFS.existsSync(NodePath.join(tree.cwd, "fixture.bin")));
  });

  it("whose folder someone removed is only forgotten; jj's own records are left alone", async () => {
    const tree = await taskCheckout("jj");
    NodeFS.rmSync(tree.cwd, { recursive: true, force: true });
    await removes(tree.check());
    assert.include(jj(tree.checkout, "workspace", "list"), NodePath.basename(tree.cwd));
  });
});
