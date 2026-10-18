// @effect-diagnostics nodeBuiltinImport:off - git and jj repositories in a temporary directory.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";

import { resetVcsCaches } from "../../../core/vcs.ts";
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

  it("starts from main without any fetch", async () => {
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
