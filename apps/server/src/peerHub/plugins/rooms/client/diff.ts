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
import * as NodePath from "node:path";

import { PEER_ROOM_DIFF_MAX_BYTES, type PeerRoomDiff } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { run, searchPath } from "../../../core/local.ts";
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

/** The checkout against the merge base, uncommitted changes included. */
async function runDiff(root: string, base: string): Promise<PeerRoomDiff | null> {
  const ref = await baseRef(root, base);
  if (ref === null) return null;
  const from = await quiet(root, ["merge-base", ref, "HEAD"]);
  const head = await quiet(root, ["rev-parse", "HEAD"]);
  if (from === "" || head === "") return null;
  const { patch, truncated } = await readPatch(root, [...DIFF, from, "--"]);
  return { state: "here", source: "run", base: from, head, patch, truncated };
}

/** A pushed ref: fetched without touching the working tree, against the merge base. */
async function pushedDiff(cwd: string, ref: string, base: string): Promise<PeerRoomDiff | null> {
  const from = await baseRef(cwd, base);
  if (from === null) return null;
  await git(cwd, ["fetch", "--no-tags", "origin", ref], FETCH_MS);
  const head = await git(cwd, ["rev-parse", "FETCH_HEAD"]);
  const merge = await git(cwd, ["merge-base", from, head]);
  const { patch, truncated } = await readPatch(cwd, [...DIFF, merge, head, "--"]);
  return { state: "here", source: "pushed", base: merge, head, patch, truncated };
}

export interface DiffInput {
  /** A live session's checkout on the task, on this computer. */
  readonly root: string | undefined;
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
    if (input.root !== undefined) {
      const here = await runDiff(input.root, input.base).catch(() => null);
      if (here !== null) return here;
    }
    const packages = input.handoffs.toReversed();
    const refs = [
      ...packages.flatMap((one) => one.delivery?.evidence.branch ?? []),
      ...input.threads.flatMap((thread) => thread.branch ?? []),
    ].filter((ref, at, all) => isSafeGitRef(ref) && all.indexOf(ref) === at);
    if (input.checkout !== undefined)
      for (const ref of refs) {
        const pushed = await pushedDiff(input.checkout.path, ref, input.base).catch(() => null);
        if (pushed !== null) return pushed;
      }
    const email = input.threads[0]?.email ?? packages[0]?.author;
    const who = email === undefined ? "The task's" : `${plain(input.nameOf(email), 40)}'s`;
    const reported = packages.flatMap((one) => [
      ...(one.delivery?.evidence.uncommitted ?? []),
      ...(one.delivery?.evidence.untracked ?? []),
    ]);
    return {
      state: "notHere" as const,
      reason:
        input.checkout === undefined
          ? `This computer has no checkout of the project, and ${who} work is not here.`
          : `${who} work has not been pushed. Watch it, or ask their agent to push.`,
      files: [...new Set([...input.files, ...reported])].slice(0, 200),
    };
  });
