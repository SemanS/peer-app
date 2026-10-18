// @effect-diagnostics nodeBuiltinImport:off - a task's own git worktree or jj workspace beside the person's checkout.
/**
 * A task's own checkout, made before its agent starts: a git worktree on a new branch, or in a
 * colocated Jujutsu repository a jj workspace whose change carries a bookmark of the same name. Peer
 * writes into a jj repository only through jj: a Git worktree there would be a checkout jj does not
 * know.
 *
 * @module peerHub/plugins/herdr/client/worktree
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { checkoutKind, runJj } from "../../../core/vcs.ts";
import { isSafeGitRef } from "../../../gitSafety.ts";
import {
  bookmarkNameArgument,
  escapeRevsetString,
  exactStringPattern,
} from "../../../../vcs/JjRevset.ts";

/** A dedicated task checkout; no shell interpolation or edits to the person's current tree. */
export async function prepareHerdrTaskWorktree(input: {
  readonly checkout: string;
  readonly baseBranch: string;
  readonly worktrees: string;
  readonly task: string;
}): Promise<{ readonly cwd: string; readonly branch: string; readonly vcs: "git" | "jj" }> {
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
  const kind = await checkoutKind(input.checkout);
  if (kind?.kind === "jj-unsupported") throw new Error(kind.reason);
  if (kind?.kind === "jj") {
    await prepareJjWorkspace({
      checkout: input.checkout,
      base: input.baseBranch,
      cwd,
      name,
      branch,
    });
    return { cwd, branch, vcs: "jj" };
  }
  await new Promise<void>((resolve, reject) => {
    NodeChildProcess.execFile(
      "git",
      ["-C", input.checkout, "worktree", "add", "-b", branch, "--", cwd, input.baseBranch],
      { timeout: 15_000, maxBuffer: 1024 * 1024, encoding: "utf8", windowsHide: true },
      (error, _stdout, stderr) =>
        error === null ? resolve() : reject(new Error(stderr.trim() || error.message)),
    );
  });
  return { cwd, branch, vcs: "git" };
}

/**
 * A colocated jj workspace at `cwd` on a new change above the base, as upstream's `JjWorkspaces`
 * makes one, with the bookmark on that change. The base is the local bookmark, else the remote's;
 * a workspace that could not be made whole is forgotten again.
 */
async function prepareJjWorkspace(input: {
  readonly checkout: string;
  readonly base: string;
  readonly cwd: string;
  readonly name: string;
  readonly branch: string;
}) {
  const base = escapeRevsetString(input.base);
  // Outside the try: a failed fetch has made nothing yet, so there is nothing to undo.
  await fetchBaseBookmark(input.checkout, input.base);
  const revset = `coalesce(bookmarks(exact:"${base}"), remote_bookmarks(exact:"${base}", exact:"origin"))`;
  try {
    await runJj(
      input.checkout,
      ["workspace", "add", "--colocate", "--name", input.name, "-r", revset, input.cwd],
      { timeoutMs: 30_000 },
    );
    await runJj(input.cwd, ["bookmark", "create", bookmarkNameArgument(input.branch), "-r", "@"], {
      timeoutMs: 15_000,
    });
  } catch (failure) {
    await runJj(input.checkout, ["workspace", "forget", input.name]).catch(() => undefined);
    await NodeFSP.rm(input.cwd, { recursive: true, force: true });
    throw failure;
  }
}

/**
 * A base another person pushed is only on the remote. Fetch that one bookmark, so no other bookmark
 * moves, and let a failure end the launch with jj's own message. A local bookmark or the project's
 * trunk needs no fetch: the person's own `jj git fetch` keeps those.
 */
async function fetchBaseBookmark(checkout: string, base: string) {
  const local = await runJj(
    checkout,
    ["bookmark", "list", "--ignore-working-copy", "-T", 'name ++ "\\n"', exactStringPattern(base)],
    { timeoutMs: 10_000 },
  );
  if (local.trim() !== "") return;
  const trunk = await runJj(
    checkout,
    [
      "log",
      "--ignore-working-copy",
      "--no-graph",
      "-r",
      `trunk() & remote_bookmarks(exact:"${escapeRevsetString(base)}", exact:"origin")`,
      "-T",
      "change_id",
    ],
    { timeoutMs: 10_000 },
  );
  if (trunk.trim() !== "") return;
  await runJj(checkout, ["git", "fetch", "--remote", "origin", "-b", exactStringPattern(base)], {
    timeoutMs: 30_000,
  });
}
