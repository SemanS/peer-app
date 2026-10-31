// @effect-diagnostics nodeBuiltinImport:off - whether a run's folder is still on this computer.
/**
 * Reading a pinned moment of an agent's work (`core/workSnapshots.ts`) back: from the ref alone, so
 * it needs neither the agent's workspace nor a jj that remembers the commits. A pin that is not
 * here may be on origin when its author shares work in progress; it comes down once a minute at
 * most, and pins are never moved, so what was read stays what it was.
 *
 * @module peerHub/plugins/rooms/snapshots
 */
import * as NodeFS from "node:fs";

import type { PeerRoomSnapshot } from "@t3tools/contracts";
import * as Option from "effect/Option";
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
    run: Schema.optional(Schema.String),
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
  const { run, ...kept } = facts;
  const sinceLast =
    run === undefined ? undefined : await sincePrevious(gitDir, place, key, run, base, head);
  return {
    state: "here",
    ...kept,
    ...(await readLines(gitDir, base, head)),
    ...(sinceLast === undefined ? {} : { sinceLast }),
  };
}

const readLines = async (gitDir: string, from: string, head: string) => {
  const { patch, truncated } = await readPatch(gitDir, [...DIFF, from, head, "--"]);
  const counted = (await git(gitDir, ["diff", "--numstat", from, head, "--"]))
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => line.split("\t"));
  return {
    files: counted.length,
    added: counted.reduce((sum, [added]) => sum + (Number(added) || 0), 0),
    removed: counted.reduce((sum, [, removed]) => sum + (Number(removed) || 0), 0),
    diff: {
      state: "here" as const,
      source: "snapshot" as const,
      base: from,
      head,
      patch,
      truncated,
    },
  };
};

const parentsOf = async (gitDir: string, ref: string) => {
  const [head = "", base = EMPTY_TREE] = (
    await git(gitDir, ["log", "-1", "--format=%P", ref, "--"])
  )
    .trim()
    .split(" ");
  return { head, base };
};

/**
 * What the message at `key` added to the run's message before it. Moved onto a new base in between,
 * the earlier state is carried onto this one's first, so what the rebase brought in stays out.
 * A carry that conflicts has no honest answer, and the whole work stands alone.
 */
async function sincePrevious(
  gitDir: string,
  place: RoomPlace,
  key: string,
  run: string,
  base: string,
  head: string,
) {
  const seq = Number(key.slice("message-".length));
  if (!key.startsWith("message-")) return undefined;
  const prefix = snapshotPrefix(place);
  const pins = await git(gitDir, [
    "for-each-ref",
    "--format=%(refname:lstrip=-1)%00%(contents:subject)",
    `${prefix}/`,
  ]);
  const previous = pins
    .split("\n")
    .flatMap((line) => {
      const [name = "", subject = ""] = line.split("\0");
      const number = /^message-(\d+)$/.exec(name)?.[1];
      const facts = Option.getOrUndefined(decodeRunFacts(subject));
      return number !== undefined && Number(number) < seq && facts?.run === run
        ? [Number(number)]
        : [];
    })
    .toSorted((a, b) => b - a)[0];
  if (previous === undefined) return undefined;
  const earlier = await parentsOf(gitDir, `${prefix}/message-${previous}`);
  const from =
    earlier.base === base
      ? earlier.head
      : await git(gitDir, [
          "merge-tree",
          "--write-tree",
          `--merge-base=${earlier.base}`,
          base,
          earlier.head,
        ]).then(
          (tree) => tree.trim(),
          () => undefined,
        );
  return from === undefined
    ? undefined
    : { seq: previous, ...(await readLines(gitDir, from, head)) };
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

const RunFacts = Schema.fromJsonString(
  Schema.Struct({ run: Schema.optional(Schema.String), root: Schema.optional(Schema.String) }),
);
const decodeRunFacts = Schema.decodeUnknownOption(RunFacts);

/** Where this computer's `run` last worked, while that folder is still here. */
export async function pinnedRoot(gitDir: string, place: RoomPlace, run: string) {
  const pins = await git(gitDir, [
    "for-each-ref",
    "--sort=-creatordate",
    "--format=%(contents:subject)",
    `${snapshotPrefix(place)}/`,
  ]).catch(() => "");
  for (const line of pins.split("\n")) {
    const facts = Option.getOrUndefined(decodeRunFacts(line));
    if (facts?.run !== run || facts.root === undefined) continue;
    return NodeFS.existsSync(facts.root) ? facts.root : undefined;
  }
  return undefined;
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
