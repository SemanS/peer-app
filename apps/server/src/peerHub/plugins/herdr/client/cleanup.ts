// @effect-diagnostics nodeBuiltinImport:off - removes a task checkout Peer made, once nothing in it can be lost.
/**
 * Removing a task's own checkout (`worktree.ts`) once its task is done. It is removed only when
 * nothing in it can be lost: it is a direct child of the folder Peer makes task checkouts in, still
 * the folder Peer made and a checkout of the person's repository; nothing in it is uncommitted or
 * untracked; every commit or change it made is on a remote, its own checkout history (git's HEAD
 * reflog) included; it holds no other repository; and nothing ignored sits in it but folders a
 * build makes again (`node_modules/`, `dist/`…). A `.env`, a `.venv/` or a data folder is someone's.
 * Anything else keeps it and says why, in words for a person. Whether an agent still runs in it is
 * the caller's to know.
 *
 * Removal checks everything once more first. A git worktree then goes through `git worktree remove`
 * without `--force`, which itself refuses a dirty or locked worktree; a jj workspace is forgotten
 * through jj from the main checkout, then its folder removed. The task's branch or bookmark stays.
 * A folder someone removed already is only forgotten by Peer: the repository is left alone, as
 * `git worktree prune` would also drop other worktrees whose disk is not mounted.
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

/** Ignored folders a build or an install makes again; anything else ignored keeps the checkout. */
const REBUILT = new Set([
  "node_modules",
  "dist",
  "build",
  "target",
  "coverage",
  ".turbo",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".vite",
  ".cache",
  ".parcel-cache",
  ".gradle",
  ".codegraph",
  "__pycache__",
  ".pytest_cache",
]);

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

const listed = (paths: ReadonlyArray<string>) =>
  `${paths.slice(0, 3).join(", ")}${paths.length > 3 ? ", …" : ""}`;

/**
 * Why removing the folder would lose what no commit holds, if it would: something ignored that a
 * build does not make again, or another repository inside it (a nested worktree's own changes do
 * not show in this one's status). jj ignores what `.gitignore` ignores, so git's list holds in a
 * colocated jj workspace too, where the workspace's own `.jj/` is the one more folder allowed.
 */
async function leftovers(cwd: string, jj: boolean): Promise<string | null> {
  const ignored = (
    await git(cwd, ["status", "--porcelain=v1", "--ignored=traditional", "-z"], true)
  )
    .split("\0")
    .filter((entry) => entry.startsWith("!! "))
    .map((entry) => entry.slice(3))
    .filter((path) =>
      path.endsWith("/") ? !REBUILT.has(NodePath.basename(path)) && !(jj && path === ".jj/") : true,
    );
  if (ignored.length > 0) return `it holds ignored files no commit keeps (${listed(ignored)})`;
  const nested = await run(
    "find",
    [
      cwd,
      "-mindepth",
      "1",
      "(",
      "-type",
      "d",
      "(",
      ...[...REBUILT].flatMap((name, index) =>
        index === 0 ? ["-name", name] : ["-o", "-name", name],
      ),
      ")",
      "-prune",
      ")",
      "-o",
      "-mindepth",
      "2",
      "(",
      "-name",
      ".git",
      "-o",
      "-name",
      ".jj",
      ")",
      "-print",
    ],
    { timeoutMs: 30_000 },
  );
  const repositories = nested
    .split("\n")
    .filter(Boolean)
    .map((path) => NodePath.relative(cwd, NodePath.dirname(path)));
  return repositories.length > 0 ? `it holds another repository (${listed(repositories)})` : null;
}

/** jj's workspaces of a repository: name → root. */
async function jjWorkspaces(mainRoot: string): Promise<ReadonlyArray<readonly [string, string]>> {
  const out = await runJj(mainRoot, [
    "workspace",
    "list",
    "--ignore-working-copy",
    "-T",
    'name ++ "\\t" ++ root ++ "\\n"',
  ]);
  return out
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
  const checkout = realpath(input.checkout);
  if (checkout === null) return kept("its repository is not on this computer");
  const name = NodePath.basename(input.cwd);
  if (
    name === "" ||
    name.startsWith(".") ||
    NodePath.resolve(input.cwd) !== NodePath.join(NodePath.resolve(input.worktrees), name)
  )
    return kept(NOT_PEERS);
  const parent = realpath(input.worktrees);
  if (parent === null || !NodeFS.existsSync(NodePath.join(parent, name)))
    // Gone already: Peer forgets it and leaves the repository's own records alone.
    return { ok: true, remove: async () => undefined };
  const cwd = NodePath.join(parent, name);
  if (realpath(cwd) !== cwd || cwd === checkout || checkout.startsWith(`${cwd}${NodePath.sep}`))
    return kept(NOT_PEERS);
  if (input.identity !== undefined) {
    const stat = await NodeFSP.stat(cwd);
    if (`${stat.dev}:${stat.ino}` !== input.identity)
      return kept("its folder is not the one Peer made");
  }
  const inspect = async (): Promise<
    { readonly reason: string } | { readonly reason: null; readonly act: () => Promise<void> }
  > => {
    forgetCheckoutKind(cwd);
    const kind = await checkoutKind(cwd);
    if (kind?.kind === "jj") return inspectJjWorkspace({ cwd, mainRoot: kind.mainRoot, checkout });
    if (kind?.kind === "git") return inspectGitWorktree({ checkout, cwd });
    return { reason: kind?.kind === "jj-unsupported" ? kind.reason : "it is no longer a checkout" };
  };
  try {
    const found = await inspect();
    if (found.reason !== null) return kept(found.reason);
  } catch (failure) {
    forgetCheckoutKind(cwd);
    return kept(
      `Peer could not check it (${failure instanceof Error ? failure.message.split("\n")[0] : "no answer"})`,
    );
  }
  return {
    ok: true,
    // Everything is checked once more right before: work may have arrived since.
    remove: async () => {
      const again = await inspect();
      if (again.reason !== null) throw new Error(again.reason);
      await again.act();
      forgetCheckoutKind(cwd);
    },
  };
}

async function inspectGitWorktree(input: { readonly checkout: string; readonly cwd: string }) {
  const { checkout, cwd } = input;
  if (realpath((await git(cwd, ["rev-parse", "--show-toplevel"])).trim()) !== cwd)
    return { reason: NOT_PEERS };
  const common = (dir: string) =>
    git(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).then((out) =>
      realpath(out.trim()),
    );
  if ((await common(cwd)) !== (await common(checkout)))
    return { reason: "it is not a worktree of the project's repository" };
  const changes = (await git(cwd, ["status", "--porcelain=v1", "--untracked-files=all"], true))
    .split("\n")
    .filter(Boolean);
  if (changes.length > 0)
    return {
      reason: `it has ${plural(changes.length, "uncommitted change", "uncommitted changes")}`,
    };
  const count = async (args: ReadonlyArray<string>) => {
    const value = Number((await git(cwd, ["rev-list", "--count", ...args])).trim());
    if (!Number.isInteger(value)) throw new Error("git did not count the commits");
    return value;
  };
  const unpushed = await count(["HEAD", "--not", "--remotes"]);
  if (unpushed > 0)
    return { reason: `${plural(unpushed, "commit is", "commits are")} on no remote branch yet` };
  // This worktree's own HEAD history goes with it: a commit only it reaches would be lost.
  const visited = (await git(cwd, ["reflog", "show", "--format=%H", "-n", "1000", "HEAD"]))
    .split("\n")
    .filter((sha) => /^[0-9a-f]{40,64}$/.test(sha));
  if (visited.length > 0) {
    const only = await count([...new Set(visited), "--not", "--remotes", "--branches", "--tags"]);
    if (only > 0)
      return {
        reason: `${plural(only, "commit is", "commits are")} only in this checkout's history`,
      };
  }
  const left = await leftovers(cwd, false);
  if (left !== null) return { reason: left };
  return {
    reason: null,
    // Without --force git refuses a worktree that changed since, or one someone locked.
    act: () => git(checkout, ["worktree", "remove", "--", cwd]).then(() => undefined),
  };
}

async function inspectJjWorkspace(input: {
  readonly checkout: string;
  readonly cwd: string;
  readonly mainRoot: string;
}) {
  const { cwd } = input;
  const mainRoot = realpath(input.mainRoot);
  if (mainRoot === null || mainRoot === cwd || realpath(input.checkout) !== mainRoot)
    return { reason: "it is not a workspace of the project's repository" };
  const workspace = (await jjWorkspaces(mainRoot)).find(([, root]) => realpath(root) === cwd)?.[0];
  if (workspace === undefined || workspace === "default")
    return { reason: "it is not a workspace of the project's repository" };
  // A plain read snapshots the workspace first, so what the agent left in its files is in `@`.
  // Files jj will not snapshot (too large, or not auto-tracked) are listed as untracked instead.
  const status = await runJj(cwd, ["status"], { timeoutMs: 30_000 });
  if (/^Untracked paths:/m.test(status)) return { reason: "it has files jj does not track" };
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
  if ((await changes("@ & conflicts()")) > 0) return { reason: "its working copy has a conflict" };
  if ((await changes("@ & ~empty() & ~::remote_bookmarks()")) > 0)
    return { reason: "it has changes not committed and pushed" };
  // An empty change without a description is jj's fresh working copy, not work.
  const unpushed = await changes(
    '(::@ ~ ::remote_bookmarks()) ~ (empty() & description(exact:"") & ~merges())',
  );
  if (unpushed > 0)
    return {
      reason: `${plural(unpushed, "change is", "changes are")} on no remote bookmark yet`,
    };
  const left = await leftovers(cwd, true);
  if (left !== null) return { reason: left };
  return {
    reason: null,
    act: async () => {
      await runJj(mainRoot, ["workspace", "forget", workspace]);
      await NodeFSP.rm(cwd, { recursive: true, force: true });
    },
  };
}
