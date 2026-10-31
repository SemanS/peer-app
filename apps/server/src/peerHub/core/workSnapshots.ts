// @effect-diagnostics nodeBuiltinImport:off - a room's ref prefix is a digest of its place.
/**
 * What an agent's work was at a moment: a sealing Git commit whose parents are the agent's `@` and
 * the baseline of its own changes, with the facts of that moment as its message, pinned once under
 * `refs/peer/snapshots/<room>/<key>`. jj never imports the ref and never rewrites the commit, so a
 * rebase, an abandon, a `jj util gc` or the end of the session leaves it readable. A change id would
 * not do, its content moves, and neither would an operation id, jj's log may be pruned.
 *
 * @module peerHub/core/workSnapshots
 */
import * as NodeCrypto from "node:crypto";

import * as Effect from "effect/Effect";

import { run } from "./local.ts";
import type { PeerPlugins } from "./plugins/PeerPlugins.ts";
import { checkoutKind, runJj } from "./vcs.ts";

const SNAPSHOT_MS = 5_000;
const READ_MS = 8_000;
const PUSH_MS = 30_000;
const FIELD = "\\x1f";
const STACK_DEPTH = 100;

const ROOT_COMMIT = /^0+$/;
const COMMIT_ID = /^[0-9a-f]{40,64}$/;

export interface RoomPlace {
  readonly workspace: string;
  readonly project: string;
  readonly task: string;
}

export interface SealedWork {
  readonly gitDir: string;
  readonly seal: string;
  /** The agent's `@` at that moment. */
  readonly head: string;
}

export const snapshotPrefix = (place: RoomPlace) => {
  const room = [place.workspace, place.project, place.task].join("\0");
  return `refs/peer/snapshots/${NodeCrypto.createHash("sha256").update(room).digest("hex").slice(0, 32)}`;
};

export const messageKey = (seq: number) => `message-${seq}`;
export const handoffRunPrefix = (run: string) =>
  `handoff-${NodeCrypto.createHash("sha256").update(run).digest("hex").slice(0, 12)}-`;
export const handoffKey = (run: string, head: string) =>
  `${handoffRunPrefix(run)}${head.slice(0, 12)}`;

const TEMPLATE = [
  "change_id",
  "commit_id",
  'parents.map(|p| p.commit_id()).join(",")',
  "current_working_copy",
  "immutable",
  "author.email()",
  "empty",
  'if(description, "1", "")',
  'author.timestamp().utc().format("%Y-%m-%dT%H:%M:%SZ")',
  "description.first_line()",
].join(` ++ "${FIELD}" ++ `);

interface Entry {
  readonly changeId: string;
  readonly commit: string;
  readonly parents: ReadonlyArray<string>;
  readonly working: boolean;
  readonly immutable: boolean;
  readonly author: string;
  readonly empty: boolean;
  readonly described: boolean;
  /** When the change was started: jj keeps it through rewrites. */
  readonly started: number;
  readonly subject: string;
}

const readStack = async (root: string): Promise<ReadonlyArray<Entry>> =>
  (
    await runJj(
      root,
      [
        "--ignore-working-copy",
        "log",
        "--no-graph",
        "-r",
        `ancestors(@, ${STACK_DEPTH}) ~ ::trunk()`,
        "-T",
        `${TEMPLATE} ++ "\\n"`,
      ],
      { timeoutMs: READ_MS, raw: true },
    )
  )
    .split("\n")
    .flatMap((line) => {
      const f = line.split("\x1f");
      return f.length < 10
        ? []
        : [
            {
              changeId: f[0]!,
              commit: f[1]!,
              parents: f[2]!.split(",").filter((parent) => parent !== ""),
              working: f[3] === "true",
              immutable: f[4] === "true",
              author: f[5]!,
              empty: f[6] === "true",
              described: f[7] === "1",
              started: Date.parse(f[8]!),
              subject: f[9]!,
            },
          ];
    });

/**
 * The agent's own changes, newest first: from `@` down, what its author wrote since `since`, the
 * run's start. The time is what tells two agents of one person apart, since they share an author;
 * the first change that is not its own ends them, so a teammate's stays below the baseline.
 */
const ownChanges = (stack: ReadonlyArray<Entry>, since: number) => {
  const me = stack.find((entry) => entry.working)?.author;
  const own: Array<Entry> = [];
  for (const entry of stack) {
    const has = !entry.empty || entry.described;
    if (entry.working && !has) continue;
    if (entry.immutable || entry.author !== me || !has) break;
    if (!entry.working && entry.started < since) break;
    own.push(entry);
  }
  return own;
};

const git = (gitDir: string, args: ReadonlyArray<string>, timeoutMs = READ_MS) =>
  run("git", ["--git-dir", gitDir, ...args], { timeoutMs });

/**
 * Seals the work of the workspace at `root` as it stands. The caller is the agent's own step, so a
 * snapshot here takes what its files hold; one that fails seals the newest jj has. Off jj, or when
 * nothing can be read, there is no seal, and so no history to claim.
 */
export async function sealWork(
  root: string,
  at: string,
  /** The run it is for, and when it started: older changes are what it built on. */
  run?: { readonly id: string; readonly startedAt: string | undefined },
): Promise<SealedWork | null> {
  const kind = await checkoutKind(root).catch(() => null);
  if (kind?.kind !== "jj") return null;
  await runJj(root, ["util", "snapshot"], { timeoutMs: SNAPSHOT_MS }).catch(() => undefined);
  const stack = await readStack(root);
  const working = stack.find((entry) => entry.working);
  if (working === undefined) return null;
  // A timestamp to the second: a change started in the run's first second is the run's.
  const own = ownChanges(
    stack,
    run?.startedAt === undefined ? 0 : Date.parse(run.startedAt) - 1_000,
  );
  const oldest = own.at(-1) ?? working;
  // On top of nothing the first parent is jj's root commit, which Git has never heard of.
  const base = oldest.parents[0];
  const baseline = base === undefined || ROOT_COMMIT.test(base) ? undefined : base;
  const facts = JSON.stringify({
    at,
    changes: own.map((entry) => entry.changeId),
    subject: (own.find((entry) => entry.described) ?? working).subject,
    // Where the run worked: nothing else says so once its session has ended.
    ...(run === undefined ? {} : { run: run.id, root: kind.root }),
  });
  const seal = (
    await git(kind.gitDir, [
      "-c",
      "user.name=Peer",
      "-c",
      "user.email=peer@localhost",
      "commit-tree",
      `${working.commit}^{tree}`,
      "-p",
      working.commit,
      ...(baseline === undefined ? [] : ["-p", baseline]),
      "-m",
      facts,
    ])
  ).trim();
  return COMMIT_ID.test(seal) ? { gitDir: kind.gitDir, seal, head: working.commit } : null;
}

/** Pins a seal for good: `key` was never pinned, or it keeps the state it first held. */
export const pinWork = (sealed: SealedWork, place: RoomPlace, key: string) =>
  git(sealed.gitDir, ["update-ref", `${snapshotPrefix(place)}/${key}`, sealed.seal, ""]).then(
    () => true,
    () => false,
  );

/**
 * Every pin of the room goes to origin, so one a failed push left behind goes with the next, and
 * only where its person shares work in progress: a pin carries unpushed work. It runs apart from
 * the post that sealed it, and failing leaves the pin here.
 */
export const shareWork = (
  plugins: Pick<PeerPlugins["Service"], "require">,
  gitDir: string,
  place: RoomPlace,
) =>
  plugins.require("wipSharing").pipe(
    Effect.flatMap((sharing) => sharing.on),
    Effect.flatMap((on) =>
      on
        ? Effect.promise(() => {
            const pins = `${snapshotPrefix(place)}/*`;
            return git(
              gitDir,
              ["push", "--no-verify", "--quiet", "origin", `${pins}:${pins}`],
              PUSH_MS,
            ).catch(() => "");
          })
        : Effect.void,
    ),
    Effect.ignore,
    Effect.forkDetach,
    Effect.asVoid,
  );
