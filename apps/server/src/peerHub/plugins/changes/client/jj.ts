/**
 * The read-only jj and git calls the changes plugin makes, in the session's own workspace. Every jj
 * call passes `--ignore-working-copy`, so a report never snapshots the agent's files or rewrites
 * anything; the one write is the private reference that keeps a reviewed commit readable. They run
 * through core's `runJj`, which gives them the global arguments upstream's `JjProcess` adds (that
 * module needs a process spawner a plugin's layer is not given).
 *
 * @module peerHub/plugins/changes/client/jj
 */
import { run, runOutput } from "../../../core/local.ts";
import { plain } from "../../../peerText.ts";
import { runJj } from "../../../core/vcs.ts";

const FIELD = "\\x1f";
const ITEM = "\\x1d";
const RECORD = "\\x1e";
const READ_MS = 8_000;

/** What `jj log` knows of one change, without any file content. */
export interface StackEntry {
  readonly changeId: string;
  readonly commitId: string;
  readonly parents: ReadonlyArray<string>;
  /** The commit each parent is at, one per entry of `parents`. */
  readonly parentCommits: ReadonlyArray<string>;
  /** It is the workspace's working-copy change. */
  readonly working: boolean;
  /** jj holds it immutable: trunk, a tag or a teammate's untracked remote bookmark. */
  readonly immutable: boolean;
  readonly author: string;
  readonly conflict: boolean;
  readonly empty: boolean;
  readonly divergent: boolean;
  readonly bookmarks: ReadonlyArray<string>;
  readonly described: boolean;
  readonly subject: string;
  /** Empty for an immutable change: only the session's mutable changes are described to the Hub. */
  readonly paths: ReadonlyArray<string>;
}

/** Peer's own jj calls in one process run one at a time; agents' own jj commands may interleave. */
let tail: Promise<unknown> = Promise.resolve();
const serial = <A>(call: () => Promise<A>): Promise<A> => {
  const next = tail.then(call, call);
  tail = next.catch(() => undefined);
  return next;
};

const jj = (cwd: string, args: ReadonlyArray<string>, timeoutMs = READ_MS) =>
  serial(() => runJj(cwd, ["--ignore-working-copy", ...args], { timeoutMs, raw: true }));

/** What a failed jj or git call printed, first line, safe to show. */
export const messageOf = (failure: unknown) =>
  plain(
    runOutput(failure)
      .split("\n")
      .find((line) => line.trim() !== "") ?? "jj failed",
    300,
  );

/** A call that never throws: the value, or the message to show. */
export const attempt = <A>(call: () => Promise<A>) =>
  call().then(
    (value) => ({ ok: true as const, value }),
    (failure: unknown) => ({ ok: false as const, message: messageOf(failure) }),
  );

const TEMPLATE = [
  "change_id",
  "commit_id",
  `parents.map(|p| p.change_id()).join("${ITEM}")`,
  "current_working_copy",
  "immutable",
  "author.email()",
  "conflict",
  "empty",
  "divergent",
  `local_bookmarks.map(|b| b.name()).join("${ITEM}")`,
  'if(description, "1", "")',
  "description.first_line()",
  `if(immutable, "", self.diff().files().map(|e| e.path()).join("${ITEM}"))`,
  `parents.map(|p| p.commit_id()).join("${ITEM}")`,
].join(` ++ "${FIELD}" ++ `);

const list = (text: string) => (text === "" ? [] : text.split("\x1d"));

/**
 * The changes from `@` back to trunk, newest first, at most 100 deep: the session's own and those
 * it builds on. The caller says which are the session's.
 */
export async function readStack(cwd: string): Promise<ReadonlyArray<StackEntry>> {
  const out = await jj(cwd, [
    "log",
    "--no-graph",
    "-r",
    "ancestors(@, 100) ~ ::trunk()",
    "-T",
    `${TEMPLATE} ++ "${RECORD}"`,
  ]);
  const entries: StackEntry[] = [];
  for (const record of out.split("\x1e")) {
    const f = record.replace(/^\n/, "").split("\x1f");
    // A truncated last record has fewer fields; it is dropped rather than guessed.
    if (f.length < 14) continue;
    entries.push({
      changeId: f[0]!,
      commitId: f[1]!,
      parents: list(f[2]!),
      parentCommits: list(f[13]!),
      working: f[3] === "true",
      immutable: f[4] === "true",
      author: f[5]!,
      conflict: f[6] === "true",
      empty: f[7] === "true",
      divergent: f[8] === "true",
      bookmarks: list(f[9]!),
      described: f[10] === "1",
      subject: f[11]!,
      paths: list(f[12]!),
    });
  }
  return entries;
}

/** The paths whose own change differs between two commits of one change; empty for a rebase or a new description. */
export async function interdiffPaths(
  cwd: string,
  from: string,
  to: string,
): Promise<ReadonlyArray<string>> {
  const out = await jj(cwd, ["interdiff", "--from", from, "--to", to, "--name-only"]);
  return out.split("\n").filter((line) => line !== "");
}

/** Whether jj on this computer can read the commit (it may be hidden: jj addresses it by id). */
export const commitHere = (cwd: string, commit: string) =>
  jj(cwd, ["log", "--no-graph", "-r", commit, "-T", "commit_id"]).then(
    (out) => out.trim() === commit,
    () => false,
  );

/** `jj diff -r <commit> --git`, or the interdiff between two commits when `from` is given. */
export const gitDiff = (cwd: string, to: string, from?: string) =>
  jj(
    cwd,
    from === undefined
      ? ["diff", "-r", to, "--git"]
      : ["interdiff", "--from", from, "--to", to, "--git"],
    20_000,
  );

/** How many commits `to`'s parents have that `from`'s do not: what trunk gained between two versions. */
export async function gainedBetween(cwd: string, from: string, to: string): Promise<number> {
  const out = await jj(cwd, [
    "log",
    "--no-graph",
    "-r",
    `::parents(${to}) ~ ::parents(${from})`,
    "-T",
    '"."',
  ]);
  return out.trim().length;
}

/** The lines a change adds and removes, from `jj diff --stat`'s last line. */
export async function lineStat(
  cwd: string,
  commit: string,
): Promise<{ readonly added: number; readonly removed: number }> {
  const out = await jj(cwd, ["diff", "-r", commit, "--stat"]);
  return {
    added: Number(/(\d+) insertions?\(\+\)/.exec(out)?.[1] ?? 0),
    removed: Number(/(\d+) deletions?\(-\)/.exec(out)?.[1] ?? 0),
  };
}

/** Trunk's newest change, as the graph ends at it; null where trunk is jj's root. */
export async function readTrunk(cwd: string) {
  const out = await jj(cwd, [
    "log",
    "--no-graph",
    "-r",
    "trunk() ~ root()",
    "-T",
    [
      "change_id",
      "commit_id",
      "description.first_line()",
      "author.email()",
      'author.timestamp().format("%+")',
      `remote_bookmarks.map(|b| b.name() ++ "@" ++ b.remote()).join("${ITEM}")`,
      `local_bookmarks.map(|b| b.name()).join("${ITEM}")`,
    ].join(` ++ "${FIELD}" ++ `),
  ]);
  const f = out.trim().split("\x1f");
  if (f.length < 7 || f[0] === "") return null;
  return {
    changeId: f[0]!,
    commitId: f[1]!,
    subject: plain(f[2]!, 120),
    author: f[3]!,
    at: f[4]!,
    bookmark: list(f[5]!)[0] ?? list(f[6]!)[0] ?? "trunk",
  };
}

const gitIn = (gitDir: string, args: ReadonlyArray<string>) =>
  run("git", ["--git-dir", gitDir, ...args], { timeoutMs: 8_000 });

/** Whether the colocated store holds the commit (jj's commits are Git objects there). */
export const storeHas = (gitDir: string, commit: string) =>
  gitIn(gitDir, ["cat-file", "-e", `${commit}^{commit}`]).then(
    () => true,
    () => false,
  );

/** Pins a reviewed commit under a reference jj does not import, or moves the pin. */
export const pinReviewed = (gitDir: string, changeId: string, commit: string) =>
  gitIn(gitDir, ["update-ref", `refs/peer/reviewed/${changeId}`, commit]).then(() => undefined);

/** Takes the pin back; a pin that is not there is no failure. */
export const unpinReviewed = (gitDir: string, changeId: string) =>
  gitIn(gitDir, ["update-ref", "-d", `refs/peer/reviewed/${changeId}`]).then(
    () => undefined,
    () => undefined,
  );
