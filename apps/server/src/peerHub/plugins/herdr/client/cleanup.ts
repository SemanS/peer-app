// @effect-diagnostics nodeBuiltinImport:off - removes a task checkout Peer made, once nothing in it can be lost.
/**
 * Removing a task's own checkout (`worktree.ts`) once its task is done. It is removed only when
 * nothing in it can be lost: it is a direct child of the folder Peer makes task checkouts in, still
 * the folder Peer made and a checkout of the person's repository; nothing in it is uncommitted;
 * every commit or change in it is on a remote; and no ignored file sits in it outside an ignored
 * folder (a `.env` is someone's, a `node_modules/` is rebuilt). Anything else keeps it and says
 * why, in words for a person. Whether an agent still runs in it is the caller's to know.
 *
 * A git worktree goes through `git worktree remove` without `--force`, which refuses on its own a
 * worktree that became dirty since, or that someone locked; a jj workspace is forgotten through jj
 * from the main checkout, then its folder removed. The task's branch or bookmark stays: it is on the
 * remote and costs nothing.
 *
 * @module peerHub/plugins/herdr/client/cleanup
 */
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { run } from "../../../core/local.ts";
import { checkoutKind, forgetCheckoutKind, runJj } from "../../../core/vcs.ts";

/** Whether a task checkout can go: then `remove` removes it; otherwise why it stays. */
export type TaskCheckoutCheck =
  | { readonly ok: true; readonly remove: () => Promise<void> }
  | { readonly ok: false; readonly reason: string };

const kept = (reason: string): TaskCheckoutCheck => ({ ok: false, reason });
const NOT_PEERS = "it is not a task checkout Peer made";

const realpath = (path: string) => {
  try {
    return NodeFS.realpathSync(path);
  } catch {
    return null;
  }
};

const git = (cwd: string, args: ReadonlyArray<string>, raw = false) =>
  run("git", ["--no-optional-locks", "-C", cwd, ...args], { timeoutMs: 15_000, raw });

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Ignored files outside ignored folders: what removing the folder would lose that no commit holds.
 * `git status --ignored` lists a wholly ignored folder once, with a trailing slash; jj ignores what
 * `.gitignore` ignores, so the same list holds in a colocated jj workspace.
 */
async function ignoredFiles(cwd: string): Promise<ReadonlyArray<string>> {
  const listed = await git(cwd, ["status", "--porcelain=v1", "--ignored=traditional", "-z"], true);
  return listed
    .split("\0")
    .filter((entry) => entry.startsWith("!! ") && !entry.endsWith("/"))
    .map((entry) => entry.slice(3));
}

const ignoredReason = (files: ReadonlyArray<string>) =>
  `it holds ignored files no commit keeps (${files.slice(0, 3).join(", ")}${files.length > 3 ? ", …" : ""})`;

/** jj's workspaces of a repository: name → root. */
async function jjWorkspaces(mainRoot: string): Promise<ReadonlyArray<readonly [string, string]>> {
  const listed = await runJj(mainRoot, [
    "workspace",
    "list",
    "--ignore-working-copy",
    "-T",
    'name ++ "\\t" ++ root ++ "\\n"',
  ]);
  return listed
    .split("\n")
    .map((line) => line.split("\t"))
    .flatMap(([name, root]) => (name && root ? [[name, root] as const] : []));
}

/**
 * Whether the task checkout at `cwd` can be removed without losing anything. `checkout` is the
 * person's repository it was made from and `worktrees` the folder Peer makes task checkouts in.
 */
export async function checkTaskCheckout(input: {
  readonly checkout: string;
  readonly worktrees: string;
  readonly cwd: string;
  /** `dev:ino` of the folder when Peer made it: a folder made anew in its place is not Peer's. */
  readonly identity?: string;
}): Promise<TaskCheckoutCheck> {
  const parent = realpath(input.worktrees);
  const checkout = realpath(input.checkout);
  if (checkout === null) return kept("its repository is not on this computer");
  const name = NodePath.basename(input.cwd);
  if (
    name === "" ||
    name.startsWith(".") ||
    NodePath.resolve(input.cwd) !== NodePath.join(NodePath.resolve(input.worktrees), name)
  )
    return kept(NOT_PEERS);
  if (parent === null || !NodeFS.existsSync(NodePath.join(parent, name)))
    return { ok: true, remove: () => forgetMissing(checkout, NodePath.resolve(input.cwd)) };
  const cwd = NodePath.join(parent, name);
  if (realpath(cwd) !== cwd || cwd === checkout || checkout.startsWith(`${cwd}${NodePath.sep}`))
    return kept(NOT_PEERS);
  if (input.identity !== undefined) {
    const stat = await NodeFSP.stat(cwd);
    if (`${stat.dev}:${stat.ino}` !== input.identity)
      return kept("its folder is not the one Peer made");
  }
  forgetCheckoutKind(cwd);
  try {
    const kind = await checkoutKind(cwd);
    if (kind?.kind === "jj")
      return await checkJjWorkspace({ cwd, mainRoot: kind.mainRoot, checkout });
    if (kind?.kind === "git") return await checkGitWorktree({ checkout, cwd });
    if (kind?.kind === "jj-unsupported") return kept(kind.reason);
    return kept("it is no longer a checkout");
  } catch (failure) {
    forgetCheckoutKind(cwd);
    return kept(
      `Peer could not check it (${failure instanceof Error ? failure.message.split("\n")[0] : "no answer"})`,
    );
  }
}

/** The folder is gone already: the repository forgets it too, which loses nothing. */
async function forgetMissing(checkout: string, cwd: string) {
  const kind = await checkoutKind(checkout);
  if (kind?.kind === "jj") {
    const found = (await jjWorkspaces(kind.mainRoot)).find(
      ([name, root]) => name !== "default" && NodePath.resolve(root) === cwd,
    );
    if (found !== undefined) await runJj(kind.mainRoot, ["workspace", "forget", found[0]]);
    return;
  }
  await git(checkout, ["worktree", "prune"]);
}

async function checkGitWorktree(input: {
  readonly checkout: string;
  readonly cwd: string;
}): Promise<TaskCheckoutCheck> {
  const { checkout, cwd } = input;
  if (realpath((await git(cwd, ["rev-parse", "--show-toplevel"])).trim()) !== cwd)
    return kept(NOT_PEERS);
  const common = (dir: string) =>
    git(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).then((out) =>
      realpath(out.trim()),
    );
  if ((await common(cwd)) !== (await common(checkout)))
    return kept("it is not a worktree of the project's repository");
  const changes = (await git(cwd, ["status", "--porcelain=v1", "--untracked-files=all"], true))
    .split("\n")
    .filter(Boolean);
  if (changes.length > 0)
    return kept(`it has ${plural(changes.length, "uncommitted change", "uncommitted changes")}`);
  const unpushed = Number(
    (await git(cwd, ["rev-list", "--count", "HEAD", "--not", "--remotes"])).trim(),
  );
  if (!Number.isInteger(unpushed)) return kept("Peer could not tell what is pushed");
  if (unpushed > 0)
    return kept(`${plural(unpushed, "commit is", "commits are")} on no remote branch yet`);
  const ignored = await ignoredFiles(cwd);
  if (ignored.length > 0) return kept(ignoredReason(ignored));
  return {
    ok: true,
    // Without --force git refuses a worktree that changed since this check, or one someone locked.
    remove: () => git(checkout, ["worktree", "remove", "--", cwd]).then(() => undefined),
  };
}

async function checkJjWorkspace(input: {
  readonly checkout: string;
  readonly cwd: string;
  readonly mainRoot: string;
}): Promise<TaskCheckoutCheck> {
  const { cwd } = input;
  const mainRoot = realpath(input.mainRoot);
  if (mainRoot === null || mainRoot === cwd || realpath(input.checkout) !== mainRoot)
    return kept("it is not a workspace of the project's repository");
  const workspace = (await jjWorkspaces(mainRoot)).find(([, root]) => realpath(root) === cwd)?.[0];
  if (workspace === undefined || workspace === "default")
    return kept("it is not a workspace of the project's repository");
  // A plain read snapshots the workspace first, so what the agent left in its files is in `@`.
  await runJj(cwd, ["status"], { timeoutMs: 30_000 });
  const changes = async (revset: string) =>
    (
      await runJj(cwd, [
        "log",
        "--ignore-working-copy",
        "--no-graph",
        "-r",
        revset,
        "-T",
        'change_id.short() ++ "\\n"',
      ])
    )
      .split("\n")
      .filter(Boolean).length;
  if ((await changes("@ & conflicts()")) > 0) return kept("its working copy has a conflict");
  if ((await changes("@ & ~empty() & ~::remote_bookmarks()")) > 0)
    return kept("it has changes not committed and pushed");
  // An empty change without a description is jj's fresh working copy, not work.
  const unpushed = await changes(
    '(::@ ~ ::remote_bookmarks()) ~ (empty() & description(exact:"") & ~merges())',
  );
  if (unpushed > 0)
    return kept(`${plural(unpushed, "change is", "changes are")} on no remote bookmark yet`);
  const ignored = await ignoredFiles(cwd);
  if (ignored.length > 0) return kept(ignoredReason(ignored));
  return {
    ok: true,
    remove: async () => {
      // What changed in its files since this check is snapshotted now and checked once more.
      await runJj(cwd, ["status"], { timeoutMs: 30_000 });
      if ((await changes("@ & ~empty() & ~::remote_bookmarks()")) > 0)
        throw new Error("it changed since Peer looked");
      await runJj(mainRoot, ["workspace", "forget", workspace]);
      forgetCheckoutKind(cwd);
      await NodeFSP.rm(cwd, { recursive: true, force: true });
    },
  };
}
