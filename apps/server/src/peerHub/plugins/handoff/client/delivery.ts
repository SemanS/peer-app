// @effect-diagnostics nodeBuiltinImport:off - repository paths of the reported files.
/**
 * The delivery fact of a handoff (design D1 of add-handoff-facts-and-review-policy): whether the
 * files the session reported are reachable by anyone, as Peer observes it in the author's checkout
 * at `peer review`, never from the agent's words.
 *
 * - `none`: a reported file is untracked or has uncommitted changes; in Jujutsu, the working-copy
 *   change carries a reported file and has no description.
 * - `local`: every reported file is committed, the branch or change is not pushed.
 * - `shared`: the branch is pushed with nothing ahead of its upstream, or every change carrying a
 *   reported file is on a remote bookmark; open pull requests are named.
 * - `landed`: a pull request of the branch (or a bookmark) is merged, as GitHub's record or the
 *   lookup says, or the work is on trunk.
 *
 * Git: `status --porcelain -- <files>`, the upstream and how far `HEAD` is ahead of it. Jujutsu:
 * the session's own mutable changes between trunk and `@` (ids, bookmarks), whether each is under a
 * remote bookmark, and trunk; every jj read passes `--ignore-working-copy`, so nothing is
 * snapshotted or rewritten, and what the working copy holds is read from Git's view of `@-`. The
 * evidence is bounded by `PEER_HANDOFF_DELIVERY_LIMITS`.
 *
 * @module peerHub/plugins/handoff/client/delivery
 */
import * as NodePath from "node:path";

import {
  PEER_HANDOFF_DELIVERY_LIMITS as LIMITS,
  type PeerHandoffDelivery,
  type PeerHandoffDeliveryEvidence,
  type PeerWorkPullRequest,
} from "@t3tools/contracts";

import { run } from "../../../core/local.ts";
import { checkoutKind, runJj } from "../../../core/vcs.ts";
import { plain } from "../../../peerText.ts";

const READ_MS = 4_000;
const FIELD = "\\x1f";
const ITEM = "\\x1d";
const RECORD = "\\x1e";

/** A pull request Peer knows of for the work: GitHub's record of a thread, or the lookup's answer. */
export type DeliveryPullRequest = Pick<PeerWorkPullRequest, "url" | "state" | "headBranch">;

export interface DeliveryInput {
  /** The checkout the session works in. */
  readonly cwd: string;
  /** The files the session reported, relative to its repository root or absolute inside it. */
  readonly files: ReadonlyArray<string>;
  /** The computer, as the environment id the label is read from. */
  readonly environment: string;
  readonly observedAt: string;
  /** The pull requests known for the task's branches; filtered to the observed branch here. */
  readonly pullRequests: ReadonlyArray<DeliveryPullRequest>;
}

const git = (cwd: string, args: ReadonlyArray<string>) =>
  run("git", ["-C", cwd, ...args], { timeoutMs: READ_MS, raw: true });
const gitLine = (cwd: string, args: ReadonlyArray<string>) =>
  git(cwd, args).then(
    (out) => out.trim(),
    () => "",
  );
const jj = (cwd: string, args: ReadonlyArray<string>) =>
  runJj(cwd, ["--ignore-working-copy", ...args], { timeoutMs: READ_MS, raw: true });

const bounded = (items: ReadonlyArray<string>, max: number, chars = 300) =>
  [...new Set(items.map((item) => plain(item, chars)).filter((item) => item !== ""))].slice(0, max);

/** The reported files as paths relative to `root`; one outside it is left out. */
export function repositoryFiles(root: string, files: ReadonlyArray<string>): ReadonlyArray<string> {
  const out = new Set<string>();
  for (const file of files) {
    const relative = NodePath.isAbsolute(file) ? NodePath.relative(root, file) : file;
    const clean = relative.split(NodePath.sep).join("/");
    if (clean === "" || clean.startsWith("../") || clean === ".." || NodePath.isAbsolute(clean))
      continue;
    out.add(clean);
  }
  return [...out];
}

/** Which of `files` Git sees untracked, and which changed against `HEAD` (staged or not). */
async function dirtyFiles(root: string, files: ReadonlyArray<string>) {
  const out = await git(root, [
    "status",
    "--porcelain",
    "-z",
    "--untracked-files=all",
    "--",
    ...files,
  ]);
  const untracked: string[] = [];
  const uncommitted: string[] = [];
  const fields = out.split("\0");
  for (let at = 0; at < fields.length; at += 1) {
    const field = fields[at] ?? "";
    if (field.length < 4) continue;
    const code = field.slice(0, 2);
    (code === "??" ? untracked : uncommitted).push(field.slice(3));
    // A rename or copy carries its old name in the next field.
    if (/[RC]/.test(code)) at += 1;
  }
  return { untracked, uncommitted };
}

/** The pull requests of `branches`, open and merged ones apart. */
function pullRequestsOf(
  all: ReadonlyArray<DeliveryPullRequest>,
  branches: ReadonlyArray<string>,
): { readonly open: ReadonlyArray<string>; readonly merged: ReadonlyArray<string> } {
  const mine = all.filter((pr) => branches.includes(pr.headBranch));
  return {
    open: bounded(
      mine.filter((pr) => pr.state === "open").map((pr) => pr.url),
      LIMITS.pullRequests,
      400,
    ),
    merged: bounded(
      mine.filter((pr) => pr.state === "merged").map((pr) => pr.url),
      LIMITS.pullRequests,
      400,
    ),
  };
}

type Observed = {
  readonly state: PeerHandoffDelivery["state"];
  readonly evidence: PeerHandoffDeliveryEvidence;
};

function withEvidence(
  state: PeerHandoffDelivery["state"],
  e: {
    readonly untracked?: ReadonlyArray<string>;
    readonly uncommitted?: ReadonlyArray<string>;
    readonly branch?: string | undefined;
    readonly commit?: string | undefined;
    readonly changes?: ReadonlyArray<string>;
    readonly bookmarks?: ReadonlyArray<string>;
    readonly pullRequests?: ReadonlyArray<string>;
  },
): Observed {
  const list = (
    key: string,
    items: ReadonlyArray<string> | undefined,
    max: number,
    chars = 300,
  ) => {
    const kept = bounded(items ?? [], max, chars);
    return kept.length === 0 ? {} : { [key]: kept };
  };
  const one = (key: string, value: string | undefined, chars: number) => {
    const kept = value === undefined ? "" : plain(value, chars);
    return kept === "" ? {} : { [key]: kept };
  };
  return {
    state,
    evidence: {
      ...list("untracked", e.untracked, LIMITS.paths),
      ...list("uncommitted", e.uncommitted, LIMITS.paths),
      ...one("branch", e.branch, 300),
      ...one("commit", e.commit, 80),
      ...list("changes", e.changes, LIMITS.ids, 80),
      ...list("bookmarks", e.bookmarks, LIMITS.ids),
      ...list("pullRequests", e.pullRequests, LIMITS.pullRequests, 400),
    },
  };
}

async function observeGit(
  root: string,
  files: ReadonlyArray<string>,
  prs: ReadonlyArray<DeliveryPullRequest>,
): Promise<Observed> {
  const named = await gitLine(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = named === "" || named === "HEAD" ? undefined : named;
  const commit = (await gitLine(root, ["rev-parse", "HEAD"])) || undefined;
  const dirty = await dirtyFiles(root, files);
  if (dirty.untracked.length > 0 || dirty.uncommitted.length > 0)
    return withEvidence("none", { ...dirty, branch });
  const { open, merged } = pullRequestsOf(prs, branch === undefined ? [] : [branch]);
  if (merged.length > 0) return withEvidence("landed", { branch, commit, pullRequests: merged });
  // Work already on the remote's default branch is on trunk.
  const trunk = await gitLine(root, ["rev-parse", "--abbrev-ref", "refs/remotes/origin/HEAD"]);
  if (
    commit !== undefined &&
    trunk !== "" &&
    (await git(root, ["merge-base", "--is-ancestor", commit, trunk]).then(
      () => true,
      () => false,
    ))
  )
    return withEvidence("landed", { branch, commit });
  // The upstream, or a remote-tracking branch of the same name pushed without `-u`.
  let upstream = await gitLine(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (upstream === "" && branch !== undefined) {
    const remote = (await gitLine(root, ["remote"])).split("\n")[0]?.trim() ?? "";
    if (
      remote !== "" &&
      (await gitLine(root, [
        "rev-parse",
        "--verify",
        "--quiet",
        `refs/remotes/${remote}/${branch}`,
      ]))
    )
      upstream = `${remote}/${branch}`;
  }
  const ahead =
    upstream === ""
      ? null
      : Number(await gitLine(root, ["rev-list", "--count", `${upstream}..HEAD`])) || 0;
  return withEvidence(ahead === 0 ? "shared" : "local", {
    branch,
    commit,
    pullRequests: open,
  });
}

interface JjEntry {
  readonly changeId: string;
  readonly commitId: string;
  readonly working: boolean;
  readonly described: boolean;
  readonly bookmarks: ReadonlyArray<string>;
  readonly paths: ReadonlyArray<string>;
}

const list = (text: string) => (text === "" ? [] : text.split("\x1d"));

/** The session's mutable changes from `@` back to trunk, newest first, at most 100 deep. */
async function jjStack(root: string): Promise<ReadonlyArray<JjEntry>> {
  const template = [
    "change_id",
    "commit_id",
    "current_working_copy",
    'if(description, "1", "")',
    `local_bookmarks.map(|b| b.name()).join("${ITEM}")`,
    `self.diff().files().map(|e| e.path()).join("${ITEM}")`,
  ].join(` ++ "${FIELD}" ++ `);
  const out = await jj(root, [
    "log",
    "--no-graph",
    "-r",
    "ancestors(@, 100) ~ ::trunk() ~ immutable()",
    "-T",
    `${template} ++ "${RECORD}"`,
  ]);
  const entries: JjEntry[] = [];
  for (const record of out.split("\x1e")) {
    const f = record.replace(/^\n/, "").split("\x1f");
    if (f.length < 6) continue;
    entries.push({
      changeId: f[0]!,
      commitId: f[1]!,
      working: f[2] === "true",
      described: f[3] === "1",
      bookmarks: list(f[4]!),
      paths: list(f[5]!),
    });
  }
  return entries;
}

/** Of these changes, the ones no remote bookmark reaches. */
async function unpushed(root: string, ids: ReadonlyArray<string>) {
  if (ids.length === 0) return [];
  const out = await jj(root, [
    "log",
    "--no-graph",
    "-r",
    `(${ids.join(" | ")}) ~ ::remote_bookmarks()`,
    "-T",
    'change_id ++ "\\n"',
  ]);
  return out.split("\n").filter((line) => line !== "");
}

async function observeJj(
  root: string,
  files: ReadonlyArray<string>,
  prs: ReadonlyArray<DeliveryPullRequest>,
): Promise<Observed> {
  const stack = await jjStack(root);
  const working = stack.find((entry) => entry.working);
  // Git's `HEAD` is `@-` in a colocated repository: what it calls dirty is what `@` holds, read
  // without snapshotting the agent's files.
  const dirty = await dirtyFiles(root, files).catch(() => ({
    untracked: [] as string[],
    uncommitted: [] as string[],
  }));
  const inWorking = new Set([
    ...dirty.untracked,
    ...dirty.uncommitted,
    ...(working?.paths.filter((path) => files.includes(path)) ?? []),
  ]);
  if (inWorking.size > 0 && working?.described !== true)
    return withEvidence("none", {
      untracked: dirty.untracked,
      uncommitted: [...inWorking].filter((path) => !dirty.untracked.includes(path)),
      ...(working === undefined ? {} : { changes: [working.changeId] }),
    });
  const carrying = stack.filter(
    (entry) =>
      entry.paths.some((path) => files.includes(path)) || (entry.working && inWorking.size > 0),
  );
  const bookmarks = [...new Set(carrying.flatMap((entry) => entry.bookmarks))];
  const { open, merged } = pullRequestsOf(prs, bookmarks);
  const changes = carrying.map((entry) => entry.changeId);
  const commit = carrying[0]?.commitId;
  if (merged.length > 0)
    return withEvidence("landed", { changes, bookmarks, commit, pullRequests: merged });
  if (carrying.length === 0) {
    // No mutable change carries a reported file: the work is on trunk (or below it).
    const trunk = (
      await jj(root, ["log", "--no-graph", "-r", "trunk()", "-T", "commit_id"]).catch(() => "")
    ).trim();
    return withEvidence("landed", { commit: trunk || undefined });
  }
  const left = await unpushed(root, changes);
  return withEvidence(left.length === 0 ? "shared" : "local", {
    changes,
    bookmarks,
    commit,
    pullRequests: open,
  });
}

/**
 * The delivery of the reported files, or null when Peer cannot say: no file was reported, the
 * directory is no checkout Peer works in, or git or jj failed.
 */
export async function observeDelivery(input: DeliveryInput): Promise<PeerHandoffDelivery | null> {
  const found = await checkoutKind(input.cwd).catch(() => null);
  if (found === null || found.kind === "jj-unsupported") return null;
  const files = repositoryFiles(found.root, input.files);
  if (files.length === 0) return null;
  const observed = await (
    found.kind === "jj"
      ? observeJj(found.root, files, input.pullRequests)
      : observeGit(found.root, files, input.pullRequests)
  ).catch(() => null);
  if (observed === null) return null;
  return {
    ...observed,
    observedAt: input.observedAt,
    environment: input.environment,
    vcs: found.kind,
  };
}
