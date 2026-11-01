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
  const base = await latestBase(input.checkout, input.baseBranch);
  await git(
    input.checkout,
    ["worktree", "add", "--no-track", "-b", branch, "--", cwd, base],
    15_000,
  );
  return { cwd, branch, vcs: "git" };
}

const git = (checkout: string, args: ReadonlyArray<string>, timeout: number) =>
  new Promise<void>((resolve, reject) => {
    NodeChildProcess.execFile(
      "git",
      ["-C", checkout, ...args],
      { timeout, maxBuffer: 1024 * 1024, encoding: "utf8", windowsHide: true },
      (error, _stdout, stderr) =>
        error === null ? resolve() : reject(new Error(stderr.trim() || error.message)),
    );
  });

/**
 * What a task starts from: what the team pushed, where this checkout has nothing of its own beyond
 * it. A teammate's work is on the remote long before anyone pulls here, and an agent started from
 * the old tip builds without it. No remote, no network or local commits keep the local branch.
 */
async function latestBase(checkout: string, base: string) {
  const remote = `refs/remotes/origin/${base}`;
  try {
    await git(checkout, ["fetch", "--quiet", "origin", base], 10_000);
    await git(checkout, ["merge-base", "--is-ancestor", base, remote], 5_000);
    return remote;
  } catch {
    return base;
  }
}

/**
 * A colocated jj workspace at `cwd` on a new change above the base, as upstream's `JjWorkspaces`
 * makes one, with the bookmark on that change; a workspace that could not be made whole is
 * forgotten again.
 */
async function prepareJjWorkspace(input: {
  readonly checkout: string;
  readonly base: string;
  readonly cwd: string;
  readonly name: string;
  readonly branch: string;
}) {
  // Outside the try: a failed fetch has made nothing yet, so there is nothing to undo.
  const revset = await latestJjBase(input.checkout, input.base);
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
 * What a jj task starts from, as `latestBase` says for Git. Commits of the local bookmark's own
 * keep it, and that comes first here, as a fetch would then leave the bookmark in conflict. The
 * fetch names that one bookmark, so no other moves, and leaves the working copy alone: the person's
 * `@` stays where it is, and only a local bookmark tracking the remote moves, as with their own
 * `jj git fetch`. A base this computer knows outlives a failed fetch; one only the remote has ends
 * the launch with jj's own message.
 */
async function latestJjBase(checkout: string, base: string) {
  const name = escapeRevsetString(base);
  const local = `bookmarks(exact:"${name}")`;
  const remote = `remote_bookmarks(exact:"${name}", exact:"origin")`;
  const changes = (revset: string) =>
    runJj(
      checkout,
      ["log", "--ignore-working-copy", "--no-graph", "-r", revset, "-T", "change_id"],
      { timeoutMs: 10_000 },
    ).then((found) => found.trim() !== "");
  if (await changes(`${local} ~ ::${remote}`)) return local;
  const known = await changes(`${local} | ${remote}`);
  await runJj(
    checkout,
    ["git", "fetch", "--ignore-working-copy", "--remote", "origin", "-b", exactStringPattern(base)],
    { timeoutMs: known ? 10_000 : 30_000 },
  ).catch((failure: unknown) => {
    if (!known) throw failure;
  });
  return `coalesce(${remote}, ${local})`;
}
