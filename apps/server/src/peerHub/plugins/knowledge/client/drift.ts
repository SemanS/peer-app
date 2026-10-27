/**
 * Drift: entries of a project's knowledge whose governed code changed while the entry did not, as
 * kontext's `entries.drift` finds them from Git alone (no model, no tokens). At `peer review` the
 * agent that changed the code settles each before its task is handed over; after work lands on
 * the default branch, what slipped through is filed as a challenge, once per entry and head. A
 * kontext without the operation (before 0.4.0) finds nothing, and nobody is told.
 *
 * @module peerHub/plugins/knowledge/client/drift
 */
import type { PeerKnowledgeChallenge, PeerKnowledgeVerified } from "@t3tools/contracts";

import { run } from "../../../core/local.ts";
import {
  commitId,
  isKnowledgeIdentity,
  KontextApiError,
  kontextApi,
  type KontextClientShape,
} from "../../../kontext.ts";
import { block, clip, plain, plural } from "../../../peerText.ts";

export const DRIFT = "entries.drift";
export const CONFIRM = "drafts.confirm";
/** The knowledge feature's revision that takes drift challenges and confirmations. */
export const DRIFT_REVISION = 3;
/** What the Hub keeps of one drift: commits and paths. */
const DRIFT_ITEMS = 50;
/** How many entries a refused review names; the rest come at the next try. */
const REVIEW_SHOWN = 6;

export interface DriftEntry {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly path: string;
  readonly checked?: string | undefined;
  readonly changed: ReadonlyArray<string>;
  readonly commits: ReadonlyArray<{ readonly sha: string; readonly subject: string }>;
}

export interface Drift {
  readonly base: string;
  /** A commit, or `working` for the working tree with what is not committed yet. */
  readonly head: string;
  readonly entries: ReadonlyArray<DriftEntry>;
}

const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** One listed entry as Peer may repeat it; null for one whose id cannot be named safely. */
function driftEntry(raw: unknown): DriftEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.id !== "string" || !isKnowledgeIdentity(entry.id)) return null;
  const text = (key: string, max: number) =>
    typeof entry[key] === "string" ? plain(entry[key], max) : "";
  return {
    id: entry.id,
    kind: text("kind", 40),
    title: text("title", 200),
    path: text("path", 512),
    ...(typeof entry.checked === "string" ? { checked: entry.checked.slice(0, 10) } : {}),
    changed: strings(entry.changed).map((path) => plain(path, 300)),
    commits: (Array.isArray(entry.commits) ? entry.commits : []).flatMap((commit: unknown) => {
      const { sha, subject } = (commit ?? {}) as Record<string, unknown>;
      return typeof sha === "string"
        ? [{ sha, subject: typeof subject === "string" ? plain(subject, 200) : "" }]
        : [];
    }),
  };
}

/**
 * kontext's drift in `checkout` over `base..head` (a head left out is the working tree; a base left
 * out, where HEAD left the remote default branch). Null where this kontext has no drift, or none
 * at all: Peer then says nothing of it.
 */
export async function entriesDrift(
  client: KontextClientShape,
  checkout: string,
  input: { readonly base?: string; readonly head?: string },
  timeoutMs?: number,
): Promise<Drift | null> {
  try {
    const found = await kontextApi<Record<string, unknown>>(
      client,
      checkout,
      DRIFT,
      input,
      timeoutMs,
    );
    return {
      base: typeof found.base === "string" ? found.base : "",
      head: typeof found.head === "string" ? found.head : "",
      entries: (Array.isArray(found.entries) ? found.entries : []).flatMap((raw: unknown) => {
        const entry = driftEntry(raw);
        return entry === null ? [] : [entry];
      }),
    };
  } catch (error) {
    if (
      error instanceof KontextApiError &&
      (error.code === "unsupported_operation" || error.code === "incompatible")
    )
      return null;
    throw error;
  }
}

/**
 * Stamps the entry checked now and stages it (`drafts.confirm`). A person confirming it in Peer is
 * a `read` in kontext's ledger, with their one-line reason; a kontext before the ledger ignores both.
 */
export const confirmEntry = (
  client: KontextClientShape,
  checkout: string,
  id: string,
  because?: string,
) =>
  kontextApi<{ readonly id: string; readonly path: string; readonly checked: string }>(
    client,
    checkout,
    CONFIRM,
    { id, kind: "read", ...(because === undefined ? {} : { because }) },
    60_000,
  );

/** The ledger operation that runs an entry's `verify` command. */
export const VERIFY = "drafts.verify";
/** A check is a project's own command (a test, a build): kontext bounds it, Peer waits longer. */
const VERIFY_TIMEOUT_MS = 180_000;
const OUTPUT_TAIL = 2048;

/**
 * Runs an entry's own check through kontext (`drafts.verify`), which appends the outcome to its
 * ledger: whether it passed, its exit code, the end of its output, the time and commit of the line.
 * Unavailable, not an error, where this kontext has no such operation.
 */
export async function verifyEntry(
  client: KontextClientShape,
  checkout: string,
  id: string,
): Promise<PeerKnowledgeVerified> {
  let raw: Record<string, unknown>;
  try {
    raw = await kontextApi<Record<string, unknown>>(
      client,
      checkout,
      VERIFY,
      { id },
      VERIFY_TIMEOUT_MS,
    );
  } catch (error) {
    if (
      error instanceof KontextApiError &&
      (error.code === "unsupported_operation" || error.code === "incompatible")
    )
      return {
        available: false,
        reason: `Running an entry's check needs a newer kontext here (it has no ${VERIFY}).`,
      };
    throw error;
  }
  const output = typeof raw.output_tail === "string" ? raw.output_tail.slice(-OUTPUT_TAIL) : "";
  return {
    available: true,
    passed: raw.passed === true,
    exitCode:
      typeof raw.exit_code === "number" && Number.isInteger(raw.exit_code) ? raw.exit_code : null,
    // A cut can start inside a character that takes two units; its lone half is dropped.
    outputTail: block(output.replace(/^[\udc00-\udfff]/, ""), OUTPUT_TAIL),
    at: typeof raw.at === "string" ? plain(raw.at, 40) : "",
    commit: commitId(raw.commit),
  };
}

/** The entries an agent challenged in its own context: `[against <id>]` anywhere in a line. */
export function challengedIn(lines: Iterable<string>): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const line of lines)
    for (const [, id] of line.matchAll(/\[against\s+([^\]\s]+)\s*\]/gi)) if (id) ids.add(id);
  return ids;
}

const listed = (items: ReadonlyArray<string>, shown: number) =>
  `${items.slice(0, shown).join(", ")}${items.length > shown ? ` and ${items.length - shown} more` : ""}`;

/**
 * Why `peer review` stops while entries the agent's work drifted from are not settled, and what to
 * do; null when none is left. An entry the agent confirmed, edited, superseded or retired is not
 * listed any more (its file changed with the code); one it challenged in its own context
 * (`challenged`) counts as settled.
 */
export function reviewRefusal(
  drift: Drift,
  challenged: ReadonlySet<string>,
): { readonly reason: string; readonly next: string } | null {
  const open = drift.entries.filter((entry) => !challenged.has(entry.id));
  if (open.length === 0) return null;
  const lines = open.slice(0, REVIEW_SHOWN).map((entry) => {
    const commits =
      entry.commits.length === 0 ? "" : ` in ${plural(entry.commits.length, "commit")}`;
    return `- ${entry.id} (${entry.kind}: "${clip(entry.title, 90)}"): you changed ${listed(entry.changed, 4)}${commits}`;
  });
  const more = open.length - lines.length;
  return {
    reason: [
      `project knowledge was not checked against your change: ${plural(open.length, "entry", "entries")} govern${open.length === 1 ? "s" : ""} code you changed while ${open.length === 1 ? "it" : "they"} stayed as written.`,
      ...lines,
      ...(more > 0 ? [`and ${more} more, named once these are settled.`] : []),
      "Settle each: if it still holds, run kontext confirm <id> (it stages the entry with today's check); if it changed, edit, supersede or retire the entry; if it no longer holds and you cannot fix it, write `- [against <id>] why` under For the team and tell your person.",
    ].join("\n"),
    next: "settle each entry above, then run peer review again.",
  };
}

/** The reason a drift challenge carries: at most the Hub's 300 characters. */
export function driftReason(entry: DriftEntry): string {
  const head = `Code it governs changed in ${plural(Math.max(1, entry.commits.length), "commit")} since it was last checked: `;
  return clip(`${head}${listed(entry.changed, 5)}`, 300);
}

/** What the Hub takes of a drift: full commit ids and repository-relative paths, 50 of each. */
export function driftBody(head: string, entry: DriftEntry) {
  const full = (sha: string) => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(sha);
  return {
    head,
    commits: [...new Set(entry.commits.map((commit) => commit.sha).filter(full))].slice(
      0,
      DRIFT_ITEMS,
    ),
    paths: [
      ...new Set(
        entry.changed.filter(
          (path) =>
            path !== "" &&
            !path.startsWith("/") &&
            !path.includes("\\") &&
            !path.split("/").includes(".."),
        ),
      ),
    ].slice(0, DRIFT_ITEMS),
  };
}

/**
 * Where drift was last filed up to, kept in the repository as a local ref beside the changes
 * plugin's `refs/peer/reviewed/*`: default refspecs never push it and jj never imports it, and every
 * worktree of the repository reads the same one, so a restart picks up where Peer left off.
 */
const CHECKED_REF = "refs/peer/knowledge/drift";

/** The checkout's Git, as drift needs it; a test gives a stand-in. */
export interface DriftGit {
  /** The commit the remote default branch is at, as this checkout last fetched it; null if none. */
  readonly defaultHead: (checkout: string) => Promise<string | null>;
  /** Subjects of the commits this checkout has; others are left out. */
  readonly subjects: (
    checkout: string,
    shas: ReadonlyArray<string>,
  ) => Promise<ReadonlyMap<string, string>>;
  /** The default branch's head drift was last filed up to in this repository; null before. */
  readonly checkedHead: (checkout: string) => Promise<string | null>;
  readonly setCheckedHead: (checkout: string, head: string) => Promise<void>;
}

const commitAt = (checkout: string, ref: string) =>
  run("git", ["-C", checkout, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
    timeoutMs: 5000,
  }).then(
    (sha) => (/^[0-9a-f]{40,64}$/.test(sha) ? sha : null),
    () => null,
  );

export const localGit: DriftGit = {
  checkedHead: (checkout) => commitAt(checkout, CHECKED_REF),
  setCheckedHead: async (checkout, head) => {
    await run("git", ["-C", checkout, "update-ref", CHECKED_REF, head], { timeoutMs: 5000 });
  },
  defaultHead: async (checkout) => {
    const git = (...args: string[]) => run("git", ["-C", checkout, ...args], { timeoutMs: 5000 });
    const named = await git("symbolic-ref", "--quiet", "refs/remotes/origin/HEAD").catch(() => "");
    for (const ref of [named, "refs/remotes/origin/main", "refs/remotes/origin/master"]) {
      if (ref === "") continue;
      const sha = await commitAt(checkout, ref);
      if (sha !== null) return sha;
    }
    return null;
  },
  subjects: async (checkout, shas) => {
    const wanted = shas.filter((sha) => /^[0-9a-f]{7,64}$/i.test(sha)).slice(0, 200);
    if (wanted.length === 0) return new Map();
    const out = await run(
      "git",
      [
        "-C",
        checkout,
        "log",
        "--no-walk=unsorted",
        "--ignore-missing",
        "--format=%H%x09%s",
        ...wanted,
      ],
      { timeoutMs: 5000 },
    ).catch(() => "");
    return new Map(
      out.split("\n").flatMap((line) => {
        const at = line.indexOf("\t");
        return at < 0 ? [] : [[line.slice(0, at), plain(line.slice(at + 1), 200)] as const];
      }),
    );
  },
};

/**
 * The challenges filed after the default branch advanced in a checkout: the head each checkout's
 * default branch was at when last seen, and the entries filed at each head. Where this process has
 * not seen a head yet, drift starts from the one the repository keeps (`stored`), else from the
 * head now (`baseline`); a move whose drift was not read, or not all filed, is read again from the
 * same base; an entry filed at a head is not filed again.
 */
export function driftWatch() {
  const seen = new Map<string, string>();
  const filed = new Set<string>();
  return {
    /** Whether this process saw a head at `place`: if not, ask the repository for `stored`. */
    knows: (place: string) => seen.has(place),
    /** The base to read drift from, when the head moved since it was last seen at `place`. */
    moved: (
      place: string,
      head: string,
      stored: string | null = null,
    ): { readonly base: string } | "baseline" | null => {
      const before = seen.get(place) ?? stored ?? undefined;
      if (!seen.has(place)) seen.set(place, before ?? head);
      if (before === undefined) return "baseline";
      return before === head ? null : { base: before };
    },
    /** Drift up to `head` is filed: the next move reads from there. */
    reached: (place: string, head: string) => {
      seen.set(place, head);
    },
    filed: (entry: string, head: string) => filed.has(`${entry}\u0000${head}`),
    file: (entry: string, head: string) => {
      if (filed.size >= 2000) filed.delete(filed.values().next().value!);
      filed.add(`${entry}\u0000${head}`);
    },
  };
}

/** A confirmation committed since the challenge was first raised: the day it was checked on or after. */
export const confirmedSince = (
  challenge: Pick<PeerKnowledgeChallenge, "firstAt">,
  checked: string | undefined,
) => checked !== undefined && checked >= challenge.firstAt.slice(0, 10);
