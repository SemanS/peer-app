/**
 * An agent's steps: what jj's evolution log holds of the change in its workspace, one entry for each
 * snapshot Peer took after a tool step, so this reads what the Hub never had. Every read uses
 * `--ignore-working-copy`: looking must not snapshot under an agent at work.
 *
 * @module peerHub/plugins/rooms/steps
 */
import { PEER_ROOM_DIFF_MAX_BYTES, type PeerRoomDiff, type PeerRoomStep } from "@t3tools/contracts";

import { runJj } from "../../../core/vcs.ts";

const STEPS_MAX = 30;
const JJ_MS = 15_000;
const COUNTED_MAX = 1_000;
const COMMIT_ID = /^[0-9a-f]{40,64}$/;

const LOG =
  'commit.commit_id() ++ "\\t" ++ commit.committer().timestamp().utc().format("%Y-%m-%dT%H:%M:%SZ") ++ "\\n"';

const CHANGE =
  'change_id ++ "\t" ++ parents.map(|parent| parent.commit_id()).join(",") ++ "\t" ++ commit_id ++ "\t" ++ description.first_line()';

const read = (root: string, args: ReadonlyArray<string>) =>
  runJj(root, ["--ignore-working-copy", ...args], { timeoutMs: JJ_MS, raw: true });

const history = async (root: string) =>
  (await read(root, ["evolog", "-r", "@", "--no-graph", "-n", String(STEPS_MAX + 1), "-T", LOG]))
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [commit = "", at = ""] = line.split("\t");
      return { commit, at };
    });

/** The first version has no earlier one, so its step is the change itself. */
const stepPatch = (root: string, commit: string, previous: string | undefined) =>
  read(
    root,
    previous === undefined
      ? ["diff", "--git", "-r", commit]
      : ["interdiff", "--git", "--from", previous, "--to", commit],
  );

export function patchCounts(patch: string) {
  const files: Array<string> = [];
  let added = 0;
  let removed = 0;
  for (const line of patch.split("\n")) {
    const header = /^diff --git a\/.* b\/(.*)$/.exec(line);
    if (header !== null) files.push(header[1] ?? "");
    else if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { files, added, removed };
}

// A step between two commits never changes, and an agent's next step should cost one read.
const counted = new Map<string, ReturnType<typeof patchCounts>>();

/** The steps of the change in the workspace at `root`, newest first; a step that moved no line is left out. */
export async function workspaceSteps(root: string): Promise<ReadonlyArray<PeerRoomStep>> {
  const entries = await history(root);
  const steps: Array<PeerRoomStep> = [];
  for (const [index, entry] of entries.slice(0, STEPS_MAX).entries()) {
    const previous = entries[index + 1]?.commit;
    const key = `${previous ?? ""}:${entry.commit}`;
    const counts =
      counted.get(key) ??
      patchCounts(await stepPatch(root, entry.commit, previous).catch(() => ""));
    if (counted.size >= COUNTED_MAX) counted.clear();
    counted.set(key, counts);
    if (counts.files.length > 0) steps.push({ commit: entry.commit, at: entry.at, ...counts });
  }
  return steps;
}

const carried = async (root: string) => {
  const [changeId = "", parents = "", commit = "", subject = ""] = (
    await read(root, ["log", "-r", "@", "--no-graph", "-T", CHANGE])
  ).split("\t");
  return { changeId, base: parents.split(",")[0] ?? "", commit, subject };
};

/** What the workspace at `root` is working on: its change, in the words a person reads. */
export async function workspaceChange(root: string) {
  const { changeId, subject } = await carried(root);
  return { changeId, subject };
}

const asRoomDiff = (patch: string, base: string, head: string): PeerRoomDiff => {
  const whole = Buffer.from(patch);
  const truncated = whole.length > PEER_ROOM_DIFF_MAX_BYTES;
  const bytes = truncated ? whole.subarray(0, PEER_ROOM_DIFF_MAX_BYTES) : whole;
  return {
    state: "here",
    source: "run",
    base,
    head,
    patch: (truncated ? bytes.subarray(0, bytes.lastIndexOf(10) + 1) : bytes).toString("utf8"),
    truncated,
  };
};

/** The whole change in the workspace, from jj: a secondary workspace has no `.git` to ask. */
export async function changeDiff(root: string): Promise<PeerRoomDiff> {
  const { base, commit } = await carried(root);
  return asRoomDiff(await read(root, ["diff", "--git", "-r", commit]), base || commit, commit);
}

/** One step's own lines, as the room's viewer draws any diff. */
export async function stepDiff(root: string, commit: string): Promise<PeerRoomDiff | null> {
  if (!COMMIT_ID.test(commit)) return null;
  const entries = await history(root);
  const at = entries.findIndex((entry) => entry.commit === commit);
  if (at === -1) return null;
  const previous = entries[at + 1]?.commit;
  return asRoomDiff(await stepPatch(root, commit, previous), previous ?? commit, commit);
}
