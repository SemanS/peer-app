// @effect-diagnostics nodeBuiltinImport:off - git and jj repositories in a temporary directory.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";

import { resetVcsCaches } from "../../../core/vcs.ts";
import { observeDelivery, repositoryFiles, type DeliveryPullRequest } from "./delivery.ts";

const home = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-dlv-")));
const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
const ENV = {
  GIT_AUTHOR_NAME: "Ana",
  GIT_AUTHOR_EMAIL: "ana@acme.test",
  GIT_COMMITTER_NAME: "Ana",
  GIT_COMMITTER_EMAIL: "ana@acme.test",
  JJ_USER: "Ana",
  JJ_EMAIL: "ana@acme.test",
};
beforeAll(() => {
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = NodePath.join(home, ".config");
});
afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetVcsCaches();
  NodeFS.rmSync(home, { recursive: true, force: true });
});

const exec = (command: string, cwd: string, ...args: Array<string>) =>
  NodeChildProcess.execFileSync(command, args, {
    cwd,
    env: { ...process.env, ...ENV, HOME: home, XDG_CONFIG_HOME: NodePath.join(home, ".config") },
    encoding: "utf8",
    stdio: "pipe",
  });
const git = (cwd: string, ...args: Array<string>) => exec("git", cwd, ...args);
const jj = (cwd: string, ...args: Array<string>) => exec("jj", cwd, ...args);
const write = (cwd: string, file: string, text: string) => {
  NodeFS.mkdirSync(NodePath.dirname(NodePath.join(cwd, file)), { recursive: true });
  NodeFS.writeFileSync(NodePath.join(cwd, file), text);
};

let count = 0;
/** A bare origin with one commit on main, and a clone of it. */
function cloned() {
  count += 1;
  const dir = NodePath.join(home, `case-${count}`);
  NodeFS.mkdirSync(dir, { recursive: true });
  const origin = NodePath.join(dir, "origin.git");
  git(dir, "init", "--bare", "-b", "main", origin);
  const seed = NodePath.join(dir, "seed");
  git(dir, "clone", origin, seed);
  write(seed, "README.md", "acme\n");
  git(seed, "add", ".");
  git(seed, "commit", "-m", "init");
  git(seed, "push", "origin", "HEAD:main");
  const work = NodePath.join(dir, "work");
  git(dir, "clone", origin, work);
  return work;
}

const observe = (cwd: string, files: ReadonlyArray<string>, prs: DeliveryPullRequest[] = []) =>
  observeDelivery({
    cwd,
    files,
    environment: "env-ana",
    observedAt: "2026-10-30T10:00:00Z",
    pullRequests: prs,
  });

const PR = "https://github.com/acme/app/pull/12";

describe("delivery observation", () => {
  it("an untracked reported file is none, naming it", async () => {
    const work = cloned();
    git(work, "switch", "-c", "feature/contract");
    write(work, "types/concurrency.ts", "export {}\n");
    const d = await observe(work, ["types/concurrency.ts"]);
    assert.strictEqual(d?.state, "none");
    assert.deepStrictEqual(d?.evidence.untracked, ["types/concurrency.ts"]);
    assert.strictEqual(d?.evidence.branch, "feature/contract");
    assert.strictEqual(d?.vcs, "git");
    assert.strictEqual(d?.environment, "env-ana");
  });

  it("an agent's claim never changes it: a committed, unpushed branch is local", async () => {
    const work = cloned();
    git(work, "switch", "-c", "feature/contract");
    write(work, "types/concurrency.ts", "export {}\n");
    git(work, "add", ".");
    git(work, "commit", "-m", "contract");
    const d = await observe(work, [NodePath.join(work, "types/concurrency.ts")]);
    assert.strictEqual(d?.state, "local");
    assert.strictEqual(d?.evidence.branch, "feature/contract");
    assert.match(d?.evidence.commit ?? "", /^[0-9a-f]{40}$/);
  });

  it("a modified tracked file is none as uncommitted", async () => {
    const work = cloned();
    write(work, "README.md", "changed\n");
    const d = await observe(work, ["README.md"]);
    assert.strictEqual(d?.state, "none");
    assert.deepStrictEqual(d?.evidence.uncommitted, ["README.md"]);
  });

  it("a pushed branch with an open pull request is shared with its url", async () => {
    const work = cloned();
    git(work, "switch", "-c", "feature/contract");
    write(work, "types/concurrency.ts", "export {}\n");
    git(work, "add", ".");
    git(work, "commit", "-m", "contract");
    git(work, "push", "-u", "origin", "feature/contract");
    const d = await observe(
      work,
      ["types/concurrency.ts"],
      [
        { url: PR, state: "open", headBranch: "feature/contract" },
        { url: "https://github.com/acme/app/pull/9", state: "open", headBranch: "other" },
      ],
    );
    assert.strictEqual(d?.state, "shared");
    assert.deepStrictEqual(d?.evidence.pullRequests, [PR]);
  });

  it("a merged pull request record is landed", async () => {
    const work = cloned();
    git(work, "switch", "-c", "feature/contract");
    write(work, "types/concurrency.ts", "export {}\n");
    git(work, "add", ".");
    git(work, "commit", "-m", "contract");
    const d = await observe(
      work,
      ["types/concurrency.ts"],
      [{ url: PR, state: "merged", headBranch: "feature/contract" }],
    );
    assert.strictEqual(d?.state, "landed");
    assert.deepStrictEqual(d?.evidence.pullRequests, [PR]);
  });

  it("no reported file, or no checkout, is not observed", async () => {
    const work = cloned();
    assert.isNull(await observe(work, []));
    assert.isNull(await observe(work, ["../outside.ts"]));
    assert.isNull(await observe(NodeFS.mkdtempSync(NodePath.join(home, "plain-")), ["a.ts"]));
  });

  it("a session that reported no files is judged by what its checkout changed", async () => {
    // A run continued after a restart: an earlier session committed the work and pushed it.
    const work = cloned();
    git(work, "switch", "-c", "feature/contract");
    write(work, "types/concurrency.ts", "export {}\n");
    git(work, "add", ".");
    git(work, "commit", "-m", "contract");
    const local = await observe(work, []);
    assert.strictEqual(local?.state, "local");
    git(work, "push", "-u", "origin", "feature/contract");
    const shared = await observe(work, []);
    assert.strictEqual(shared?.state, "shared");
    assert.strictEqual(shared?.evidence.branch, "feature/contract");
    // Something untracked beside the pushed work still makes it none, and names it.
    write(work, "types/later.ts", "export {}\n");
    const none = await observe(work, []);
    assert.strictEqual(none?.state, "none");
    assert.deepStrictEqual(none?.evidence.untracked, ["types/later.ts"]);
  });

  it("a jj change pushed to a bookmark is shared with its change id and bookmark", async () => {
    const work = cloned();
    jj(work, "git", "init", "--colocate");
    jj(work, "bookmark", "track", "main", "--remote", "origin");
    write(work, "types/concurrency.ts", "export {}\n");
    jj(work, "describe", "-m", "contract");
    jj(work, "bookmark", "create", "contract", "-r", "@");
    jj(work, "git", "push", "--bookmark", "contract");
    jj(work, "new");
    const change = jj(work, "log", "--no-graph", "-r", "@-", "-T", "change_id").trim();
    const d = await observe(
      work,
      ["types/concurrency.ts"],
      [{ url: PR, state: "open", headBranch: "contract" }],
    );
    assert.strictEqual(d?.state, "shared");
    assert.strictEqual(d?.vcs, "jj");
    assert.deepStrictEqual(d?.evidence.changes, [change]);
    assert.deepStrictEqual(d?.evidence.bookmarks, ["contract"]);
    assert.deepStrictEqual(d?.evidence.pullRequests, [PR]);
  });

  it("a described jj change not pushed is local", async () => {
    const work = cloned();
    jj(work, "git", "init", "--colocate");
    jj(work, "bookmark", "track", "main", "--remote", "origin");
    write(work, "types/concurrency.ts", "export {}\n");
    jj(work, "describe", "-m", "contract");
    jj(work, "new");
    const d = await observe(work, ["types/concurrency.ts"]);
    assert.strictEqual(d?.state, "local");
  });

  it("a jj working copy with undescribed edits to a reported file is none", async () => {
    const work = cloned();
    jj(work, "git", "init", "--colocate");
    jj(work, "bookmark", "track", "main", "--remote", "origin");
    write(work, "types/concurrency.ts", "export {}\n");
    // A teammate's jj command snapshots it, or not: either way it is the working copy's.
    const d = await observe(work, ["types/concurrency.ts"]);
    assert.strictEqual(d?.state, "none");
    assert.deepStrictEqual(d?.evidence.untracked, ["types/concurrency.ts"]);
    jj(work, "status");
    const after = await observe(work, ["types/concurrency.ts"]);
    assert.strictEqual(after?.state, "none");
  });
});

describe("repositoryFiles", () => {
  it("keeps paths inside the root, relative", () => {
    assert.deepStrictEqual(
      repositoryFiles("/r", ["/r/a.ts", "b/c.ts", "/x/d.ts", "../e", "b/c.ts"]),
      ["a.ts", "b/c.ts"],
    );
  });
});
