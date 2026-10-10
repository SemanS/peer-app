// @effect-diagnostics nodeBuiltinImport:off - a task's own git worktree beside the person's checkout.
/**
 * A task's own checkout: a git worktree on a new branch, made before its agent starts.
 *
 * @module peerHub/plugins/herdr/client/worktree
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { isSafeGitRef } from "../../../gitSafety.ts";

/** A dedicated task checkout; no shell interpolation or edits to the person's current tree. */
export async function prepareHerdrTaskWorktree(input: {
  readonly checkout: string;
  readonly baseBranch: string;
  readonly worktrees: string;
  readonly task: string;
}): Promise<{ readonly cwd: string; readonly branch: string }> {
  if (!NodePath.isAbsolute(input.checkout) || !NodePath.isAbsolute(input.worktrees)) {
    throw new Error("The checkout and worktree directories must be full paths");
  }
  if (!isSafeGitRef(input.baseBranch))
    throw new Error("The repository branch is not a safe Git ref");
  const task =
    input.task
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70) || "task";
  const name = `${task}-${NodeCrypto.randomUUID().slice(0, 8)}`;
  const branch = `feature/${name}`;
  const cwd = NodePath.join(input.worktrees, name);
  await NodeFSP.mkdir(input.worktrees, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    NodeChildProcess.execFile(
      "git",
      ["-C", input.checkout, "worktree", "add", "-b", branch, "--", cwd, input.baseBranch],
      { timeout: 15_000, maxBuffer: 1024 * 1024, encoding: "utf8", windowsHide: true },
      (error, _stdout, stderr) =>
        error === null ? resolve() : reject(new Error(stderr.trim() || error.message)),
    );
  });
  return { cwd, branch };
}
