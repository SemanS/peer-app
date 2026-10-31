// @effect-diagnostics nodeBuiltinImport:off - temporary repositories and the real jj.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { checkoutKind, resetVcsCaches } from "../vcs.ts";
import { switchToJujutsu } from "./jujutsu.ts";

const hasJj = NodeChildProcess.spawnSync("jj", ["--version"]).status === 0;

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync("git", [...args], { cwd, encoding: "utf8" });

describe.skipIf(!hasJj)("switching a checkout to Jujutsu", () => {
  let root: string;
  const write = (name: string, text: string) =>
    NodeFS.writeFileSync(NodePath.join(root, name), text);

  beforeEach(() => {
    resetVcsCaches();
    root = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-use-jj-")));
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.email", "test@example.com");
    git(root, "config", "user.name", "Peer Test");
    write("kept.txt", "one\n");
    write("gone.txt", "two\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "first");
    git(root, "remote", "add", "origin", "https://example.invalid/repo.git");
  });

  afterEach(() => NodeFS.rmSync(root, { recursive: true, force: true }));

  it("keeps unfinished work, the commit and the remote", async () => {
    const head = git(root, "rev-parse", "HEAD");
    write("kept.txt", "staged\n");
    git(root, "add", "kept.txt");
    git(root, "rm", "-q", "gone.txt");
    write("new.txt", "untracked\n");
    write("large.bin", "x".repeat(2 * 1024 * 1024));

    await switchToJujutsu(root);

    expect((await checkoutKind(root))?.kind).toBe("jj");
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(git(root, "remote")).toBe("origin\n");
    expect(NodeFS.readFileSync(NodePath.join(root, "kept.txt"), "utf8")).toBe("staged\n");
    expect(NodeFS.readFileSync(NodePath.join(root, "new.txt"), "utf8")).toBe("untracked\n");
    expect(NodeFS.statSync(NodePath.join(root, "large.bin")).size).toBe(2 * 1024 * 1024);
    expect(git(root, "status", "--porcelain").split("\n")).toContain("M  kept.txt");
    expect(git(root, "status", "--porcelain").split("\n")).toContain("D  gone.txt");
  });

  it("does nothing to a checkout that is already on Jujutsu", async () => {
    await switchToJujutsu(root);
    const marker = NodeFS.statSync(NodePath.join(root, ".jj")).ino;
    await switchToJujutsu(root);
    expect(NodeFS.statSync(NodePath.join(root, ".jj")).ino).toBe(marker);
  });

  it("refuses in the middle of a merge and writes nothing", async () => {
    write(".git/MERGE_HEAD", git(root, "rev-parse", "HEAD"));
    await expect(switchToJujutsu(root)).rejects.toThrow("in the middle of a merge");
    expect(NodeFS.existsSync(NodePath.join(root, ".jj"))).toBe(false);
  });

  it("refuses a repository with submodules and writes nothing", async () => {
    write(".gitmodules", "");
    await expect(switchToJujutsu(root)).rejects.toThrow("submodules");
    expect(NodeFS.existsSync(NodePath.join(root, ".jj"))).toBe(false);
  });

  it("refuses a linked Git worktree and writes nothing", async () => {
    const linked = `${root}-linked`;
    git(root, "worktree", "add", "-q", "-b", "other", linked);
    try {
      await expect(switchToJujutsu(linked)).rejects.toThrow("Git worktree");
      expect(NodeFS.existsSync(NodePath.join(linked, ".jj"))).toBe(false);
    } finally {
      NodeFS.rmSync(linked, { recursive: true, force: true });
    }
  });
});
