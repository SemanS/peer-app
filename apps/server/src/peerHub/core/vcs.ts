// @effect-diagnostics nodeBuiltinImport:off globalDate:off - probes checkouts on this computer and runs git and jj in them; caches by wall-clock time.
/**
 * Which version control owns a checkout, and the ref a session in it works on. Every Peer read and
 * write that depends on it asks here, so a project that moves to Jujutsu changes everywhere at once.
 *
 * A Jujutsu repository colocated with Git is a first-class checkout: jj owns the working copy, Peer
 * reads what jj exports to Git, and writes into the repository only through jj. Detection mirrors
 * upstream's `findVcsMarkerRoot` (the nearest `.jj` or `.git` wins) and reuses its pure helpers;
 * Peer's core runs commands as promises (`run`), so it does not go through upstream's Effect
 * process services, but every jj call gets the same global arguments `JjProcess` adds.
 *
 * @module peerHub/core/vcs
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  chosenBookmarkConfigKey,
  pickBookmark,
  shownRowBookmarks,
  workspaceRefCandidates,
} from "../../jj/JjStatus.ts";
import {
  isJjVersionSupported,
  type JjAvailability,
  jjUnsupportedReason,
  parseJjVersion,
} from "../../vcs/JjAvailability.ts";
import { mainWorkspaceRootFromRepoPointer } from "../../vcs/JjRepo.ts";
import { run } from "./local.ts";

export type CheckoutKind =
  | { readonly kind: "git"; readonly root: string }
  | {
      readonly kind: "jj";
      /** The workspace the directory belongs to. */
      readonly root: string;
      /** The default workspace, which holds the colocated `.git`. */
      readonly mainRoot: string;
      readonly gitDir: string;
    }
  | { readonly kind: "jj-unsupported"; readonly root: string; readonly reason: string };

/**
 * What upstream's `JjProcess` passes to every jj it runs: no pager or colour, and no abandoning of
 * commits a Git ref moved away from, which an ordinary read would otherwise do in a colocated repo.
 */
const JJ_GLOBAL_ARGS = [
  "--no-pager",
  "--color=never",
  "--quiet",
  "--config",
  "git.abandon-unreachable-commits=false",
] as const;

/** jj in `cwd`, with the global arguments every Peer call takes. */
export function runJj(
  cwd: string,
  args: ReadonlyArray<string>,
  options: { readonly timeoutMs?: number; readonly raw?: boolean } = {},
): Promise<string> {
  return run("jj", [...JJ_GLOBAL_ARGS, ...args], { ...options, cwd });
}

const isDirectory = (path: string) => {
  try {
    return NodeFS.statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const realpath = (path: string) => {
  try {
    return NodeFS.realpathSync(path);
  } catch {
    return path;
  }
};

/** The nearest directory at or above `cwd` holding `.jj` or `.git`, as upstream finds it. */
function markerRoot(cwd: string): { root: string; marker: "jj" | "git" } | null {
  if (!isDirectory(cwd)) return null;
  let current = realpath(cwd);
  for (;;) {
    if (isDirectory(NodePath.join(current, ".jj"))) return { root: current, marker: "jj" };
    if (NodeFS.existsSync(NodePath.join(current, ".git"))) return { root: current, marker: "git" };
    const parent = NodePath.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** The kind `.t3code/vcs.json` pins at or above `dir`, as upstream's `VcsProjectConfig` reads it. */
export function pinnedKind(dir: string): "git" | "jj" | undefined {
  let current = dir;
  for (;;) {
    const candidate = NodePath.join(current, ".t3code", "vcs.json");
    if (NodeFS.existsSync(candidate)) {
      try {
        const config = JSON.parse(NodeFS.readFileSync(candidate, "utf8")) as {
          vcs?: { kind?: unknown };
          vcsKind?: unknown;
        };
        const kind = config.vcs?.kind ?? config.vcsKind;
        return kind === "git" || kind === "jj" ? kind : undefined;
      } catch {
        return undefined;
      }
    }
    const parent = NodePath.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

const AVAILABLE_TTL_MS = 10 * 60_000;
/** A missing or old jj is asked again soon: installing it should not need a restart. */
const UNUSABLE_TTL_MS = 30_000;
let availability: { readonly value: JjAvailability; readonly until: number } | undefined;

/** Whether this computer's jj is installed and new enough, from `jj --version`. */
export async function jjAvailability(): Promise<JjAvailability> {
  const now = Date.now();
  if (availability !== undefined && availability.until > now) return availability.value;
  const banner = await run("jj", ["--version"], { timeoutMs: 5000 }).catch(() => null);
  const version = banner === null ? null : parseJjVersion(banner);
  const value: JjAvailability =
    version === null
      ? { _tag: "missing" }
      : isJjVersionSupported(version)
        ? { _tag: "available", version }
        : { _tag: "unsupported-version", version };
  availability = {
    value,
    until: now + (value._tag === "available" ? AVAILABLE_TTL_MS : UNUSABLE_TTL_MS),
  };
  return value;
}

const KIND_TTL_MS = 30_000;
const kinds = new Map<string, { readonly value: CheckoutKind | null; readonly until: number }>();

/**
 * Which version control owns `dir`: Git, a usable colocated jj repository, a jj repository Peer
 * cannot work in (not colocated, or this computer's jj is missing or too old) with the reason, or
 * null outside any repository. `.t3code/vcs.json` pinning Git makes a jj repository read as Git.
 */
export async function checkoutKind(dir: string): Promise<CheckoutKind | null> {
  const now = Date.now();
  const cached = kinds.get(dir);
  if (cached !== undefined && cached.until > now) return cached.value;
  const value = await detect(dir);
  kinds.set(dir, { value, until: now + KIND_TTL_MS });
  return value;
}

/** Forget what is known of `dir` and of jj, after a jj call there failed. */
export function forgetCheckoutKind(dir: string): void {
  kinds.delete(dir);
  availability = undefined;
}

const NOT_COLOCATED = jjUnsupportedReason({
  availability: { _tag: "available", version: "" },
  colocated: false,
})!;

async function detect(dir: string): Promise<CheckoutKind | null> {
  const found = markerRoot(dir);
  if (found === null) return null;
  if (found.marker === "git") return { kind: "git", root: found.root };
  const repo = NodePath.join(found.root, ".jj", "repo");
  let mainRoot = found.root;
  if (!isDirectory(repo)) {
    try {
      mainRoot = realpath(
        mainWorkspaceRootFromRepoPointer(found.root, NodeFS.readFileSync(repo, "utf8")),
      );
    } catch {
      return {
        kind: "jj-unsupported",
        root: found.root,
        reason: "This Jujutsu workspace's repository pointer cannot be read.",
      };
    }
  }
  const gitDir = NodePath.join(mainRoot, ".git");
  const colocated = isDirectory(gitDir);
  if (pinnedKind(found.root) === "git") {
    // Pinned to Git, a jj repository is Git underneath when colocated, whatever jj's version.
    return colocated
      ? { kind: "git", root: found.root }
      : { kind: "jj-unsupported", root: found.root, reason: NOT_COLOCATED };
  }
  const reason = jjUnsupportedReason({ availability: await jjAvailability(), colocated });
  return reason === null
    ? { kind: "jj", root: found.root, mainRoot, gitDir }
    : { kind: "jj-unsupported", root: found.root, reason };
}

/** What a checkout folder holds, for binding it to a project and showing its state. */
export type CheckoutState =
  | { readonly state: "ready"; readonly kind: "git" | "jj" }
  | { readonly state: "missing" }
  | { readonly state: "unsupported"; readonly reason: string };

/**
 * Whether `path` is a checkout Peer can work in. A folder without `.git` or `.jj` of its own is
 * missing (and may be cloned into); a jj repository Peer cannot use is unsupported, never missing,
 * so nothing is cloned into it.
 */
export async function checkoutState(path: string): Promise<CheckoutState> {
  const hasJj = isDirectory(NodePath.join(path, ".jj"));
  if (!hasJj && !NodeFS.existsSync(NodePath.join(path, ".git"))) return { state: "missing" };
  if (!hasJj) return { state: "ready", kind: "git" };
  const found = await checkoutKind(path);
  if (found === null) return { state: "missing" };
  return found.kind === "jj-unsupported"
    ? { state: "unsupported", reason: found.reason }
    : { state: "ready", kind: found.kind };
}

const WORKSPACE_TEMPLATE =
  '"{\\"name\\":" ++ json(name) ++ ",\\"root\\":" ++ json(stringify(root)) ++ "}\\n"';

/**
 * The bookmark a jj working copy is on, by the rule of the app's branch label (upstream's
 * `resolveWorkspaceRefName`): a thread's workspace names its own; any other a bookmark of the
 * nearest bookmarked ancestor of `@`, and of several there, the one the person last switched to or
 * created in the app. Git's `HEAD` sits detached at `@-` in a colocated repository, so it never
 * names one. `--ignore-working-copy` keeps every read from snapshotting the agent's files.
 */
async function nearestBookmark(
  checkout: Extract<CheckoutKind, { kind: "jj" }>,
  cwd: string,
): Promise<string | undefined> {
  const rows = await runJj(
    cwd,
    [
      "log",
      "--ignore-working-copy",
      "--no-graph",
      "-r",
      "heads(::@ & bookmarks())::@",
      "-T",
      'json(local_bookmarks.map(|b| b.name())) ++ "\\n"',
    ],
    { timeoutMs: 3000 },
  );
  const segment = rows
    .split("\n")
    .filter((row) => row !== "")
    .map((row) => ({ localBookmarks: JSON.parse(row) as ReadonlyArray<string> }));
  const shown = shownRowBookmarks(segment);
  // Even a lone bookmark can belong to another managed workspace. Resolve ownership before
  // assigning an agent to its task; a deleted thread bookmark must not redirect it onto main.
  if (shown.length === 0) return undefined;
  const workspaces = (
    await runJj(cwd, ["workspace", "list", "--ignore-working-copy", "-T", WORKSPACE_TEMPLATE], {
      timeoutMs: 3000,
    })
  )
    .split("\n")
    .filter((row) => row !== "")
    .map((row) => JSON.parse(row) as { readonly name: string; readonly root: string });
  const workspace = workspaces.find((entry) => realpath(entry.root) === checkout.root);
  if (workspace === undefined) return undefined;
  const names = workspaceRefCandidates(
    segment,
    workspace.name,
    workspaces.map((entry) => entry.name),
  );
  if (names.length < 2) return names[0];
  const chosen = await run(
    "git",
    ["--git-dir", checkout.gitDir, "config", "--get", chosenBookmarkConfigKey(workspace.name)],
    { timeoutMs: 3000 },
  ).catch(() => "");
  return pickBookmark(names, chosen === "" ? null : chosen) ?? undefined;
}

/**
 * The ref a session in `cwd` works on: its Git branch, or in a jj repository its nearest bookmark;
 * undefined when there is none (a detached `HEAD`, no bookmark yet) or `cwd` is no checkout.
 */
export async function currentRef(cwd: string): Promise<string | undefined> {
  const found = await checkoutKind(cwd);
  if (found?.kind === "jj") {
    return nearestBookmark(found, cwd).catch(() => {
      forgetCheckoutKind(cwd);
      return undefined;
    });
  }
  if (found?.kind === "jj-unsupported") return undefined;
  const name = await run("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], {
    timeoutMs: 3000,
  }).catch(() => "");
  return name === "" || name === "HEAD" ? undefined : name;
}

/** Test hook: forget every cached kind and jj's availability. */
export function resetVcsCaches(): void {
  kinds.clear();
  availability = undefined;
}
