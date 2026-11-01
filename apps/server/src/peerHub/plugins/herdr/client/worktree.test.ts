// @effect-diagnostics nodeBuiltinImport:off - git and jj repositories in a temporary directory.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";

import { holdsWork, resetVcsCaches } from "../../../core/vcs.ts";
import { prepareHerdrTaskWorktree } from "./worktree.ts";

// jj 0.46 keeps repo and workspace config under the user's config directory, so the jj processes
// of this suite (its own and Peer's) run with a home inside the suite's directory.
const home = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-wt-")));
const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
beforeAll(() => {
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = NodePath.join(home, ".config");
  process.env.JJ_USER = "Bob";
  process.env.JJ_EMAIL = "bob@acme.test";
});
afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  delete process.env.JJ_USER;
  delete process.env.JJ_EMAIL;
  resetVcsCaches();
  NodeFS.rmSync(home, { recursive: true, force: true });
});

const exec = (command: string, cwd: string, ...args: Array<string>) =>
  NodeChildProcess.execFileSync(command, args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Ana",
      GIT_AUTHOR_EMAIL: "ana@acme.test",
      GIT_COMMITTER_NAME: "Ana",
      GIT_COMMITTER_EMAIL: "ana@acme.test",
    },
    encoding: "utf8",
    stdio: "pipe",
  });
const git = (cwd: string, ...args: Array<string>) => exec("git", cwd, ...args);
const jj = (cwd: string, ...args: Array<string>) => exec("jj", cwd, ...args);

/** A bare remote with main, and two colocated jj clones of it: Ana's and Bob's. */
function team() {
  const directory = NodeFS.mkdtempSync(NodePath.join(home, "team-"));
  const origin = NodePath.join(directory, "origin.git");
  git(directory, "init", "--quiet", "--bare", "--initial-branch=main", origin);
  const seed = NodePath.join(directory, "seed");
  git(directory, "clone", "--quiet", origin, seed);
  NodeFS.writeFileSync(NodePath.join(seed, "order.js"), "export const total = 1;\n");
  git(seed, "add", ".");
  git(seed, "commit", "--quiet", "-m", "start");
  git(seed, "push", "--quiet", "origin", "HEAD:main");
  const clone = (name: string) => {
    const path = NodePath.join(directory, name);
    git(directory, "clone", "--quiet", origin, path);
    jj(path, "git", "init", "--colocate");
    return path;
  };
  return {
    directory,
    origin,
    ana: clone("ana"),
    bob: clone("bob"),
    worktrees: NodePath.join(directory, "trees"),
  };
}

/** Ana pushes a bookmark with one change of her own. */
function anaPushes(ana: string, bookmark: string, file: string) {
  jj(ana, "new", "main", "-m", `work on ${bookmark}`);
  NodeFS.writeFileSync(NodePath.join(ana, file), `${bookmark}\n`);
  jj(ana, "bookmark", "create", bookmark, "-r", "@");
  jj(ana, "git", "push", "-b", bookmark);
}

const bookmarks = (cwd: string) =>
  jj(cwd, "bookmark", "list", "--all-remotes", "-T", 'name ++ "@" ++ remote ++ "\\n"');

describe("a jj task checkout on a teammate's bookmark", () => {
  it("fetches only the base bookmark, then builds the workspace on it", async () => {
    const { ana, bob, worktrees } = team();
    anaPushes(ana, "feature/ORD-11-cents", "cents.js");
    anaPushes(ana, "feature/ORD-14-vat", "vat.js");
    assert.notInclude(bookmarks(bob), "ORD-11");

    const tree = await prepareHerdrTaskWorktree({
      checkout: bob,
      baseBranch: "feature/ORD-11-cents",
      worktrees,
      task: "ORD-12",
    });

    assert.strictEqual(tree.vcs, "jj");
    assert.isTrue(NodeFS.existsSync(NodePath.join(tree.cwd, "cents.js")));
    assert.isFalse(NodeFS.existsSync(NodePath.join(tree.cwd, "vat.js")));
    const parent = jj(
      tree.cwd,
      "log",
      "--no-graph",
      "-r",
      "@-",
      "-T",
      'local_bookmarks.map(|b| b.name()).join(",") ++ "|" ++ remote_bookmarks.map(|b| b.name()).join(",")',
    );
    assert.include(parent, "feature/ORD-11-cents");
    const after = bookmarks(bob);
    assert.include(after, "feature/ORD-11-cents@origin");
    assert.notInclude(after, "feature/ORD-14-vat");
    assert.include(after, `${tree.branch}@`);
  });

  it("fetches no bookmark but its base", async () => {
    const { ana, bob, worktrees } = team();
    anaPushes(ana, "feature/ORD-11-cents", "cents.js");
    const tree = await prepareHerdrTaskWorktree({
      checkout: bob,
      baseBranch: "main",
      worktrees,
      task: "ORD-12",
    });
    assert.notInclude(bookmarks(bob), "feature/ORD-11-cents");
    assert.isTrue(NodeFS.existsSync(NodePath.join(tree.cwd, "order.js")));
  });

  it("ends the launch with jj's message and leaves nothing when the fetch fails", async () => {
    const { origin, bob, worktrees } = team();
    NodeFS.renameSync(origin, `${origin}.gone`);
    const before = jj(bob, "workspace", "list");

    let failure: unknown;
    try {
      await prepareHerdrTaskWorktree({
        checkout: bob,
        baseBranch: "feature/ORD-11-cents",
        worktrees,
        task: "ORD-12",
      });
    } catch (error) {
      failure = error;
    }

    assert.instanceOf(failure, Error);
    assert.notStrictEqual((failure as Error).message, "");
    assert.strictEqual(jj(bob, "workspace", "list"), before);
    assert.notInclude(bookmarks(bob), "ORD-12");
    assert.deepStrictEqual(NodeFS.existsSync(worktrees) ? NodeFS.readdirSync(worktrees) : [], []);
  });

  it("ends the launch when no remote has the bookmark", async () => {
    const { bob, worktrees } = team();
    let failure: unknown;
    try {
      await prepareHerdrTaskWorktree({
        checkout: bob,
        baseBranch: "feature/ORD-99-nothing",
        worktrees,
        task: "ORD-12",
      });
    } catch (error) {
      failure = error;
    }
    assert.instanceOf(failure, Error);
    assert.deepStrictEqual(NodeFS.readdirSync(worktrees), []);
    assert.notInclude(bookmarks(bob), "ORD-12");
  });
});

describe("a jj task checkout on the team's trunk", () => {
  /** A push to main that no clone has fetched yet. */
  const teamPushes = (directory: string, file: string) => {
    const seed = NodePath.join(directory, "seed");
    NodeFS.writeFileSync(NodePath.join(seed, file), "pushed\n");
    git(seed, "add", ".");
    git(seed, "commit", "--quiet", "-m", file);
    git(seed, "push", "--quiet", "origin", "HEAD:main");
  };
  /** Where the working copy stands: `@` and its parent, as commits. */
  const standing = (cwd: string) =>
    jj(
      cwd,
      "log",
      "--ignore-working-copy",
      "--no-graph",
      "-r",
      "@ | @-",
      "-T",
      'commit_id ++ "\\n"',
    );

  it("starts from what the team pushed, and the person's working copy stays put", async () => {
    const { directory, bob, worktrees } = team();
    NodeFS.writeFileSync(NodePath.join(bob, "draft.js"), "Bob's own\n");
    jj(bob, "status");
    const before = standing(bob);
    teamPushes(directory, "ledger.js");

    const tree = await prepareHerdrTaskWorktree({
      checkout: bob,
      baseBranch: "main",
      worktrees,
      task: "ORD-12",
    });

    assert.isTrue(NodeFS.existsSync(NodePath.join(tree.cwd, "ledger.js")));
    assert.isFalse(NodeFS.existsSync(NodePath.join(tree.cwd, "draft.js")));
    assert.strictEqual(standing(bob), before);
    assert.isFalse(NodeFS.existsSync(NodePath.join(bob, "ledger.js")));
    assert.strictEqual(NodeFS.readFileSync(NodePath.join(bob, "draft.js"), "utf8"), "Bob's own\n");
    // A working copy left stale would refuse this; a plain read snapshots, and finds nothing new.
    jj(bob, "status");
    assert.strictEqual(standing(bob), before);
  });

  it("starts from the remote's tip where the local bookmark tracks nothing", async () => {
    const { directory, bob, worktrees } = team();
    jj(bob, "bookmark", "untrack", "main", "--remote", "origin");
    teamPushes(directory, "ledger.js");
    const tree = await prepareHerdrTaskWorktree({
      checkout: bob,
      baseBranch: "main",
      worktrees,
      task: "ORD-12",
    });
    assert.isTrue(NodeFS.existsSync(NodePath.join(tree.cwd, "ledger.js")));
  });

  it("keeps a local bookmark with commits of its own, and leaves it out of conflict", async () => {
    const { directory, bob, worktrees } = team();
    jj(bob, "new", "main", "-m", "mine");
    NodeFS.writeFileSync(NodePath.join(bob, "mine.js"), "mine\n");
    jj(bob, "bookmark", "set", "main", "-r", "@");
    jj(bob, "new");
    teamPushes(directory, "theirs.js");

    const tree = await prepareHerdrTaskWorktree({
      checkout: bob,
      baseBranch: "main",
      worktrees,
      task: "ORD-12",
    });

    assert.isTrue(NodeFS.existsSync(NodePath.join(tree.cwd, "mine.js")));
    assert.isFalse(NodeFS.existsSync(NodePath.join(tree.cwd, "theirs.js")));
    assert.notInclude(jj(bob, "bookmark", "list", "--all-remotes"), "conflict");
  });

  it("starts from what it knows when the fetch fails", async () => {
    const { origin, bob, worktrees } = team();
    NodeFS.renameSync(origin, `${origin}.gone`);
    const tree = await prepareHerdrTaskWorktree({
      checkout: bob,
      baseBranch: "main",
      worktrees,
      task: "ORD-12",
    });
    assert.isTrue(NodeFS.existsSync(NodePath.join(tree.cwd, "order.js")));
  });
});

describe("what a jj task checkout holds", () => {
  it("is nothing on its fresh working copy, and its change once the agent wrote", async () => {
    const { directory, bob, worktrees } = team();
    const tree = await prepareHerdrTaskWorktree({
      checkout: bob,
      baseBranch: "main",
      worktrees,
      task: "ORD-12",
    });
    assert.isFalse(await holdsWork(tree.cwd, "main"));

    NodeFS.writeFileSync(NodePath.join(tree.cwd, "cents.js"), "1\n");
    assert.isTrue(await holdsWork(tree.cwd, "main"));

    jj(tree.cwd, "commit", "-m", "cents");
    assert.isTrue(await holdsWork(tree.cwd, "main"));
    assert.isFalse(await holdsWork(NodePath.join(directory, "gone"), "main"));
  });
});

describe("a task's git checkout", () => {
  const repositories = () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(home, "git-"));
    const origin = NodePath.join(directory, "origin.git");
    git(directory, "init", "--quiet", "--bare", "--initial-branch=main", origin);
    const ana = NodePath.join(directory, "ana");
    git(directory, "clone", "--quiet", origin, ana);
    NodeFS.writeFileSync(NodePath.join(ana, "order.js"), "export const total = 1;\n");
    git(ana, "add", ".");
    git(ana, "commit", "--quiet", "-m", "start");
    git(ana, "push", "--quiet", "origin", "HEAD:main");
    const bob = NodePath.join(directory, "bob");
    git(directory, "clone", "--quiet", origin, bob);
    return { directory, ana, bob };
  };
  const commit = (cwd: string, name: string) => {
    NodeFS.writeFileSync(NodePath.join(cwd, name), "1\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "--quiet", "-m", name);
  };

  it("starts from what the team pushed, not from an old local tip", async () => {
    const { directory, ana, bob } = repositories();
    commit(ana, "ledger.js");
    git(ana, "push", "--quiet", "origin", "HEAD:main");
    const tree = await prepareHerdrTaskWorktree({
      checkout: bob,
      baseBranch: "main",
      worktrees: NodePath.join(directory, "trees"),
      task: "page",
    });
    assert.isTrue(NodeFS.existsSync(NodePath.join(tree.cwd, "ledger.js")));
    assert.throws(() => git(tree.cwd, "config", `branch.${tree.branch}.remote`));
  });

  it("keeps a local tip with commits of its own, and works without a remote", async () => {
    const { directory, ana, bob } = repositories();
    commit(bob, "mine.js");
    commit(ana, "theirs.js");
    git(ana, "push", "--quiet", "origin", "HEAD:main");
    const kept = await prepareHerdrTaskWorktree({
      checkout: bob,
      baseBranch: "main",
      worktrees: NodePath.join(directory, "trees"),
      task: "kept",
    });
    assert.isTrue(NodeFS.existsSync(NodePath.join(kept.cwd, "mine.js")));

    git(ana, "remote", "remove", "origin");
    const alone = await prepareHerdrTaskWorktree({
      checkout: ana,
      baseBranch: "main",
      worktrees: NodePath.join(directory, "trees"),
      task: "alone",
    });
    assert.isTrue(NodeFS.existsSync(NodePath.join(alone.cwd, "theirs.js")));
  });
});
