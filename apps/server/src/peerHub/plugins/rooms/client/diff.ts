// @effect-diagnostics nodeBuiltinImport:off - the diff's bytes are read from git as it prints them.
/**
 * The room's diff (design D8): computed by git on the reader's computer, never held by the Hub.
 * First this computer's run's checkout against the merge base, uncommitted changes included; else
 * a pushed ref fetched into this computer's checkout, which leaves the working tree as it was; else
 * what the Hub knows, and the words that say why the work is not here.
 *
 * @module peerHub/plugins/rooms/diff
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";

import { PEER_ROOM_DIFF_MAX_BYTES, type PeerRoomDiff } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { run, runOutput, searchPath } from "../../../core/local.ts";
import { checkoutKind } from "../../../core/vcs.ts";
import { GIT_ALLOWED_PROTOCOLS, isSafeGitRef } from "../../../gitSafety.ts";
import { plain } from "../../../peerText.ts";

const READ_MS = 4_000;
const DIFF_MS = 15_000;
const FETCH_MS = 20_000;

/** Bounded by bytes as it is read: `run` would fail on a diff over its buffer. */
export const readPatch = (
  cwd: string,
  args: ReadonlyArray<string>,
  max = PEER_ROOM_DIFF_MAX_BYTES,
): Promise<{ readonly patch: string; readonly truncated: boolean }> =>
  new Promise((resolve, reject) => {
    const child = NodeChildProcess.spawn("git", ["-C", cwd, ...args], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: DIFF_MS,
      env: {
        ...process.env,
        PATH: searchPath().join(NodePath.delimiter),
        GIT_TERMINAL_PROMPT: "0",
        GIT_ALLOW_PROTOCOL: GIT_ALLOWED_PROTOCOLS,
      },
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size <= max || truncated) return;
      truncated = true;
      child.kill();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (!truncated && code !== 0) {
        reject(new Error(`git diff ended with ${code}`));
        return;
      }
      const bytes = Buffer.concat(chunks).subarray(0, max);
      const whole = truncated ? bytes.subarray(0, bytes.lastIndexOf(10) + 1) : bytes;
      resolve({ patch: whole.toString("utf8"), truncated });
    });
  });

const git = (cwd: string, args: ReadonlyArray<string>, timeoutMs = READ_MS) =>
  run("git", ["-C", cwd, ...args], { timeoutMs });
const quiet = (cwd: string, args: ReadonlyArray<string>) => git(cwd, args).catch(() => "");

/** The base as this computer knows it: the remote's branch, else its own. */
async function baseRef(cwd: string, base: string) {
  if (!isSafeGitRef(base)) return null;
  for (const ref of [`refs/remotes/origin/${base}`, `refs/heads/${base}`])
    if ((await quiet(cwd, ["rev-parse", "--verify", "--quiet", ref])) !== "") return ref;
  return null;
}

const DIFF = ["diff", "--no-color", "--no-ext-diff", "--find-renames"] as const;

/** The checkout against the merge base, uncommitted changes included; none for a run on the base. */
async function runDiff(root: string, base: string): Promise<PeerRoomDiff | null> {
  const ref = await baseRef(root, base);
  if (ref === null) return null;
  if ((await quiet(root, ["rev-parse", "--abbrev-ref", "HEAD"])) === base) return null;
  const from = await quiet(root, ["merge-base", ref, "HEAD"]);
  const head = await quiet(root, ["rev-parse", "HEAD"]);
  if (from === "" || head === "") return null;
  const { patch, truncated } = await readPatch(root, [...DIFF, from, "--"]);
  return { state: "here", source: "run", base: from, head, patch, truncated };
}

const FETCH = ["fetch", "--no-tags", "--no-write-fetch-head", "origin"] as const;

/** Peer's own ref for a fetched branch: no branch moves, and `FETCH_HEAD` is the person's. */
const privateRef = (ref: string) =>
  `refs/peer/rooms/${NodeCrypto.createHash("sha256").update(ref).digest("hex").slice(0, 32)}`;

/** Why a fetch failed where that is not "it is not on the remote", in words for the room. */
function fetchTrouble(failure: unknown): string | null {
  const output = runOutput(failure).toLowerCase();
  if (/could(n't| not) find remote ref/.test(output)) return null;
  if (output.startsWith("command failed")) return "Git timed out asking the remote";
  return /authentication|permission denied|access denied|could not read (username|password)|publickey|\b403\b/.test(
    output,
  )
    ? "The remote refused this computer's sign-in"
    : "This computer could not reach the remote";
}

type Pushed = PeerRoomDiff | { readonly trouble: string } | null;

/** A pushed ref: fetched without touching the working tree, against the merge base. */
async function pushedDiff(cwd: string, ref: string, base: string): Promise<Pushed> {
  const from = await baseRef(cwd, base);
  if (from === null) return null;
  const into = privateRef(ref);
  try {
    await git(cwd, [...FETCH, `+refs/heads/${ref}:${into}`], FETCH_MS);
  } catch (failure) {
    const trouble = fetchTrouble(failure);
    return trouble === null ? null : { trouble };
  }
  const head = await git(cwd, ["rev-parse", into]);
  const merge = await git(cwd, ["merge-base", from, head]);
  const { patch, truncated } = await readPatch(cwd, [...DIFF, merge, head, "--"]);
  return { state: "here", source: "pushed", base: merge, head, patch, truncated };
}

/** The refs the task's work may be on, likeliest first: handoffs, then threads, never the base. */
export const pushedRefs = (
  handoffs: DiffInput["handoffs"],
  threads: DiffInput["threads"],
  base: string,
) =>
  [
    ...handoffs.toReversed().flatMap((one) => one.delivery?.evidence.branch ?? []),
    ...threads.flatMap((thread) => thread.branch ?? []),
  ].filter((ref, at, all) => ref !== base && isSafeGitRef(ref) && all.indexOf(ref) === at);

/**
 * The first ref that is on the remote, fetched for a session to start on: its remote branch for
 * git, its bookmark for jj, whose workspace takes a bookmark and fetches it itself.
 */
export async function changeToReview(cwd: string, refs: ReadonlyArray<string>) {
  const jj = (await checkoutKind(cwd).catch(() => null))?.kind === "jj";
  for (const ref of refs) {
    const fetched = await git(
      cwd,
      [...FETCH, `+refs/heads/${ref}:refs/remotes/origin/${ref}`],
      FETCH_MS,
    ).then(
      () => true,
      () => false,
    );
    if (fetched) return { ref, base: jj ? ref : `origin/${ref}` };
  }
  return undefined;
}

/** The newest run that does the task's work here: a review run only reads it. */
export function workRun(input: {
  /** This computer's open runs on the task, newest first. */
  readonly runs: ReadonlyArray<{
    readonly id: string;
    readonly keys: ReadonlyArray<string>;
  }>;
  readonly reviews: ReadonlySet<string>;
  /** The live sessions on the task. */
  readonly sessions: ReadonlyArray<{
    readonly run?: string | undefined;
    readonly root: string;
    readonly repositoryId: string | undefined;
  }>;
  /** This computer's reported threads: a detached run is found by its branch. */
  readonly threads: ReadonlyArray<{ readonly id: string; readonly branch?: string | undefined }>;
}) {
  for (const run of input.runs) {
    if (input.reviews.has(run.id)) continue;
    const session = input.sessions.find((candidate) => candidate.run === run.id);
    if (session !== undefined) return { root: session.root, repository: session.repositoryId };
    const branch = input.threads.find((thread) => run.keys.includes(thread.id))?.branch;
    if (branch !== undefined) return { branch };
  }
  return undefined;
}

/** The worktree of this checkout that has `branch` out, if any. */
export async function worktreeOf(cwd: string, branch: string) {
  const listing = await quiet(cwd, ["worktree", "list", "--porcelain"]);
  return listing
    .split("\n\n")
    .find((entry) => entry.split("\n").includes(`branch refs/heads/${branch}`))
    ?.split("\n")[0]
    ?.replace(/^worktree /, "");
}

export interface DiffInput {
  /** The checkout of this computer's newest run that does the task's work. */
  readonly root: string | undefined;
  /** The base of the repository `root` is on, when that is not `base`. */
  readonly rootBase?: string | undefined;
  /** The base branch of `checkout`'s repository. */
  readonly base: string;
  /** This computer's checkout of the project. */
  readonly checkout: { readonly path: string } | undefined;
  /** The task's handoff packages, oldest first. */
  readonly handoffs: ReadonlyArray<{
    readonly author?: string | undefined;
    readonly delivery?:
      | {
          readonly evidence: {
            readonly branch?: string | undefined;
            readonly uncommitted?: ReadonlyArray<string> | undefined;
            readonly untracked?: ReadonlyArray<string> | undefined;
          };
        }
      | undefined;
  }>;
  /** The task's threads, newest first. */
  readonly threads: ReadonlyArray<{ readonly branch?: string | undefined; readonly email: string }>;
  /** The paths the Hub knows of the task. */
  readonly files: ReadonlyArray<string>;
  readonly nameOf: (email: string) => string;
}

export const roomDiff = (input: DiffInput): Effect.Effect<PeerRoomDiff> =>
  Effect.promise(async () => {
    // A diff with nothing in it answers only if nothing better turns up.
    let empty: PeerRoomDiff | null = null;
    let trouble: string | null = null;
    if (input.root !== undefined) {
      const here = await runDiff(input.root, input.rootBase ?? input.base).catch(() => null);
      if (here?.state === "here" && here.patch !== "") return here;
      empty = here;
    }
    if (input.checkout !== undefined)
      for (const ref of pushedRefs(input.handoffs, input.threads, input.base)) {
        const pushed = await pushedDiff(input.checkout.path, ref, input.base).catch(() => null);
        if (pushed === null) continue;
        if ("trouble" in pushed) trouble ??= pushed.trouble;
        else if (pushed.state === "here" && pushed.patch !== "") return pushed;
        else empty ??= pushed;
      }
    if (empty !== null) return empty;
    const packages = input.handoffs.toReversed();
    const email = input.threads[0]?.email ?? packages[0]?.author;
    const who = email === undefined ? "The task's" : `${plain(input.nameOf(email), 40)}'s`;
    const reported = packages.flatMap((one) => [
      ...(one.delivery?.evidence.uncommitted ?? []),
      ...(one.delivery?.evidence.untracked ?? []),
    ]);
    const reason =
      input.checkout === undefined
        ? `This computer has no checkout of the project, and ${who} work is not here.`
        : trouble !== null
          ? `${trouble}, so Peer cannot tell whether ${who.replace(/^The/, "the")} work is pushed. Refresh to try again.`
          : `${who} work has not been pushed. Watch it, or ask their agent to push.`;
    return {
      state: "notHere" as const,
      reason,
      files: [...new Set([...input.files, ...reported])].slice(0, 200),
    };
  });
