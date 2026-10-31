/**
 * Reading a pinned moment of an agent's work (`core/workSnapshots.ts`) back: from the ref alone, so
 * it needs neither the agent's workspace nor a jj that remembers the commits. A pin that is not
 * here may be on origin when its author shares work in progress; it comes down once a minute at
 * most, and pins are never moved, so what was read stays what it was.
 *
 * @module peerHub/plugins/rooms/snapshots
 */
import type { PeerRoomSnapshot } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { run } from "../../../core/local.ts";
import { checkoutKind } from "../../../core/vcs.ts";
import { snapshotPrefix, type RoomPlace } from "../../../core/workSnapshots.ts";
import { DIFF, FETCH, readPatch } from "./diff.ts";

const READ_MS = 4_000;
const FETCH_MS = 20_000;
const FETCH_GAP_MS = 60_000;

const KEY = /^(message-[1-9]\d*|handoff-[0-9a-f]{12}-[0-9a-f]{12})$/;
/** Git's empty tree: what a change on top of nothing is compared to. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const Facts = Schema.fromJsonString(
  Schema.Struct({
    at: Schema.String,
    changes: Schema.Array(Schema.String),
    subject: Schema.String,
  }),
);
const decodeFacts = Schema.decodeUnknownSync(Facts);

type Here = Omit<Extract<PeerRoomSnapshot, { state: "here" }>, "handoff">;

const git = (gitDir: string, args: ReadonlyArray<string>, timeoutMs = READ_MS) =>
  run("git", ["--git-dir", gitDir, ...args], { timeoutMs, raw: true });

/** The Git store of the checkout at `folder`: jj's or Git's own. */
export async function storeOf(folder: string): Promise<string | undefined> {
  const kind = await checkoutKind(folder).catch(() => null);
  if (kind?.kind === "jj") return kind.gitDir;
  if (kind?.kind !== "git") return undefined;
  const dir = await run("git", ["-C", folder, "rev-parse", "--absolute-git-dir"], {
    timeoutMs: READ_MS,
  }).catch(() => "");
  return dir === "" ? undefined : dir.trim();
}

export async function readPin(gitDir: string, place: RoomPlace, key: string): Promise<Here | null> {
  if (!KEY.test(key)) return null;
  const ref = `${snapshotPrefix(place)}/${key}`;
  const shown = await git(gitDir, ["log", "-1", "--format=%P%x00%B", ref, "--"]).catch(() => "");
  const [parents = "", message = ""] = shown.split("\0");
  const [head, base = EMPTY_TREE] = parents.trim().split(" ");
  if (head === undefined || head === "") return null;
  let facts: typeof Facts.Type;
  try {
    facts = decodeFacts(message.trim());
  } catch {
    return null;
  }
  const { patch, truncated } = await readPatch(gitDir, [...DIFF, base, head, "--"]);
  const counted = (await git(gitDir, ["diff", "--numstat", base, head, "--"]))
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => line.split("\t"));
  return {
    state: "here",
    ...facts,
    files: counted.length,
    added: counted.reduce((sum, [added]) => sum + (Number(added) || 0), 0),
    removed: counted.reduce((sum, [, removed]) => sum + (Number(removed) || 0), 0),
    diff: { state: "here", source: "snapshot", base, head, patch, truncated },
  };
}

/** The run's newest handoff pin here, as a key. */
export async function newestHandoff(gitDir: string, place: RoomPlace, prefix: string) {
  const answer = await git(gitDir, [
    "for-each-ref",
    "--sort=-creatordate",
    "--count=1",
    "--format=%(refname:lstrip=-1)",
    `${snapshotPrefix(place)}/${prefix}*`,
  ]).catch(() => "");
  const key = answer.trim();
  return key === "" ? undefined : key;
}

const fetched = new Map<string, number>();

/** Whether this looked on origin; a store asked within the minute is not asked again. */
export async function fetchPins(gitDir: string, place: RoomPlace, now: number) {
  const pins = `${snapshotPrefix(place)}/*`;
  const asked = `${gitDir}\0${pins}`;
  if (now - (fetched.get(asked) ?? 0) < FETCH_GAP_MS) return false;
  fetched.set(asked, now);
  return git(gitDir, [...FETCH, `${pins}:${pins}`], FETCH_MS).then(
    () => true,
    () => false,
  );
}
