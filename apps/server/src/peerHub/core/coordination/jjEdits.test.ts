// @effect-diagnostics nodeBuiltinImport:off globalDate:off - temporary jj checkouts, a git spy and wall-clock commit times.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, assert, beforeEach, describe, it } from "@effect/vitest";

import { changedPaths, readCommittedSince, readGitStatus } from "./edits.ts";

const env = {
  ...process.env,
  JJ_USER: "Ana",
  JJ_EMAIL: "ana@acme.test",
  GIT_AUTHOR_NAME: "Ana",
  GIT_AUTHOR_EMAIL: "ana@acme.test",
  GIT_COMMITTER_NAME: "Ana",
  GIT_COMMITTER_EMAIL: "ana@acme.test",
};
const sh = (cwd: string, command: string, ...args: string[]) =>
  NodeChildProcess.execFileSync(command, args, { cwd, env, encoding: "utf8" }).trim();

let dir = "";
let root = "";
const originalPath = process.env.PATH;

beforeEach(() => {
  dir = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-jj-edits-")));
  root = NodePath.join(dir, "app");
  NodeFS.mkdirSync(root);
  sh(root, "git", "init", "-q", "-b", "main");
  NodeFS.writeFileSync(NodePath.join(root, "a.ts"), "a\n");
  sh(root, "git", "add", "a.ts");
  sh(root, "git", "commit", "-q", "-m", "init");
  sh(root, "jj", "--quiet", "git", "init", "--colocate");
});

afterEach(() => {
  process.env.PATH = originalPath;
  NodeFS.rmSync(dir, { recursive: true, force: true });
});

describe("an agent's changes in a colocated jj checkout", () => {
  it("are seen when a shell command writes a file", async () => {
    NodeFS.writeFileSync(NodePath.join(root, "b.ts"), "b\n");
    assert.include(changedPaths(await readGitStatus(root)), "b.ts");
  });

  it("are what `jj commit` committed, and nothing after `jj squash` rewrote history", async () => {
    const since = Date.now() - 1000;
    const before = sh(root, "git", "rev-parse", "HEAD");
    NodeFS.writeFileSync(NodePath.join(root, "b.ts"), "b\n");
    sh(root, "jj", "--quiet", "commit", "-m", "b");
    assert.deepStrictEqual(await readCommittedSince(root, before, since), ["b.ts"]);

    const committed = sh(root, "git", "rev-parse", "HEAD");
    NodeFS.writeFileSync(NodePath.join(root, "c.ts"), "c\n");
    sh(root, "jj", "--quiet", "squash");
    // @- was rewritten to hold c.ts too: its old id is no ancestor of HEAD any more.
    assert.notStrictEqual(sh(root, "git", "rev-parse", "HEAD"), committed);
    assert.deepStrictEqual(await readCommittedSince(root, committed, since), []);
  });

  it("are read without taking git's optional locks", async () => {
    const bin = NodePath.join(dir, "spy");
    NodeFS.mkdirSync(bin);
    const log = NodePath.join(dir, "git-args.log");
    const real = sh(dir, "sh", "-c", "command -v git");
    NodeFS.writeFileSync(
      NodePath.join(bin, "git"),
      `#!/bin/sh\necho "$@" >> '${log}'\nexec '${real}' "$@"\n`,
      { mode: 0o755 },
    );
    process.env.PATH = `${bin}${NodePath.delimiter}${originalPath ?? ""}`;
    await readGitStatus(root);
    assert.match(NodeFS.readFileSync(log, "utf8"), /^--no-optional-locks -C .* status /m);
  });
});
