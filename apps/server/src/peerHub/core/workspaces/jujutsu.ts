// @effect-diagnostics nodeBuiltinImport:off - compares a person's checkout before and after jj.
/**
 * Puts Jujutsu beside Git in a checkout on this computer. jj writes no working file here, but the
 * checkout may hold someone's unfinished work, so the step refuses what jj would not carry and
 * compares the checkout before and after. A difference undoes the step: `.jj` goes, and Git's
 * `HEAD` and index come back as they were.
 *
 * @module peerHub/core/workspaces/jujutsu
 */
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { run } from "../local.ts";
import { checkoutKind, forgetCheckoutKind, jjAvailability, pinnedKind, runJj } from "../vcs.ts";

const JJ_MS = 5 * 60_000;
const GIT_MS = 60_000;

/** What Git leaves in `.git` while an operation waits for a person; jj would not carry it on. */
const UNFINISHED = {
  MERGE_HEAD: "a merge",
  CHERRY_PICK_HEAD: "a cherry-pick",
  REVERT_HEAD: "a revert",
  BISECT_LOG: "a bisect",
  "rebase-merge": "a rebase",
  "rebase-apply": "a rebase",
} as const;

const git = (cwd: string, args: ReadonlyArray<string>) =>
  run("git", args, { cwd, timeoutMs: GIT_MS, raw: true });

/**
 * `git status`, except that jj marks a new file intent-to-add: it was untracked and still is, in
 * Git's commits. Each line is one path, with every untracked file named.
 */
const statusLines = async (cwd: string) =>
  (await git(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]))
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => (line.startsWith(" A ") ? `?? ${line.slice(3)}` : line))
    .toSorted();

/** Size, mode and time of each file Git can see: rewriting or removing one changes its line. */
const fileStamps = async (cwd: string) => {
  const listed = await git(cwd, [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
    "--deduplicate",
  ]);
  const stamps: Array<string> = [];
  for (const path of listed.split("\0").filter((entry) => entry !== "")) {
    const stat = await NodeFSP.lstat(NodePath.join(cwd, path)).catch(() => null);
    stamps.push(
      stat === null ? `${path} gone` : `${path} ${stat.mode} ${stat.size} ${stat.mtimeMs}`,
    );
  }
  return stamps.toSorted();
};

/** Everything of the person's the step must leave as it found it. */
const checkoutFacts = async (cwd: string) =>
  JSON.stringify({
    head: await git(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]).catch(() => ""),
    refs: await git(cwd, [
      "for-each-ref",
      "--format=%(refname) %(objectname)",
      "refs/heads",
      "refs/tags",
      "refs/remotes",
      "refs/stash",
    ]),
    status: await statusLines(cwd),
    files: await fileStamps(cwd),
  });

/** Why this Git checkout must not take jj yet, in words for the person; null when it may. */
function refusal(path: string) {
  const gitDir = NodePath.join(path, ".git");
  if (!NodeFS.statSync(gitDir, { throwIfNoEntry: false })?.isDirectory()) {
    return "This checkout is a Git worktree. Switch the repository's main checkout instead.";
  }
  if (NodeFS.existsSync(NodePath.join(path, ".gitmodules"))) {
    // A project's checkout can be a clone other than the one the person works in, and lag behind it.
    return `${path} has submodules, and Jujutsu does not manage them. If the repository dropped them, update this checkout, then switch.`;
  }
  for (const [marker, operation] of Object.entries(UNFINISHED)) {
    if (NodeFS.existsSync(NodePath.join(gitDir, marker))) {
      return `Git is in the middle of ${operation} here. Finish it, then switch.`;
    }
  }
  return pinnedKind(path) === "git"
    ? "`.t3code/vcs.json` pins this repository to Git. Change that first."
    : null;
}

async function colocate(path: string) {
  const reason = refusal(path);
  if (reason !== null) throw new Error(reason);
  const gitDir = NodePath.join(path, ".git");
  const index = await NodeFSP.readFile(NodePath.join(gitDir, "index")).catch(() => null);
  const head = await NodeFSP.readFile(NodePath.join(gitDir, "HEAD"));
  const undo = async () => {
    await NodeFSP.rm(NodePath.join(path, ".jj"), { recursive: true, force: true });
    await NodeFSP.writeFile(NodePath.join(gitDir, "HEAD"), head);
    if (index !== null) await NodeFSP.writeFile(NodePath.join(gitDir, "index"), index);
  };
  const before = await checkoutFacts(path);
  try {
    await run("jj", ["git", "init", "--colocate"], { cwd: path, timeoutMs: JJ_MS });
  } catch (failure) {
    await undo();
    throw failure;
  }
  if ((await checkoutFacts(path)) !== before) {
    await undo();
    throw new Error("Jujutsu changed this checkout, so Peer put it back as it was.");
  }
}

/**
 * Makes the checkout at `path` a colocated jj repository: `.git`, its remotes and the working files
 * stay. A jj repository without `.git` gains one. Throws, in words for the person, when it cannot.
 */
export async function switchToJujutsu(path: string) {
  const jj = await jjAvailability();
  if (jj._tag === "missing") throw new Error("Jujutsu is not installed on this computer.");
  if (jj._tag === "unsupported-version") {
    throw new Error(`Jujutsu ${jj.version} is too old for Peer. Update it, then switch.`);
  }
  const found = await checkoutKind(path);
  if (found === null) throw new Error("This repository is not on this computer yet.");
  if (found.kind === "jj") return;
  try {
    if (found.kind === "git") await colocate(path);
    else await runJj(path, ["git", "colocation", "enable"], { timeoutMs: JJ_MS });
  } finally {
    forgetCheckoutKind(path);
  }
}
