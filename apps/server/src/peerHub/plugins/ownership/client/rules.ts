/**
 * Who answers for what, from the Hub's view of a project, as the Hub decides it
 * (`server/src/features/ownership`): the rules the verdicts, notices and commands of this plugin go
 * by, so they sit with the endpoints that speak the Hub's language. The client runtime mirrors them
 * for display (`packages/client-runtime/src/peer/ownershipRules.ts`), which this plugin cannot
 * import, and `rules.test.ts` runs this twin on the cases of the fixture all three share
 * (`ownership.fixtures.json`). Change a rule, change the fixture and every side.
 *
 * @module peerHub/plugins/ownership/client/rules
 */
import type { PeerOwnerCall, PeerOwnerMap } from "@t3tools/contracts";

/** The people on a project now. */
export interface Members {
  readonly has: (email: string) => boolean;
}

/**
 * A task's effective owner: the owner of its own row while they are on the project, else the owner
 * its area has in the map while they are; nobody when neither is. An owner who left owns nothing, so
 * what they owned falls back as if it had no owner.
 */
export function effectiveOwner(
  task: { readonly area?: string | undefined },
  row: { readonly owner: string } | undefined,
  map: Pick<PeerOwnerMap, "areas">,
  members: Members,
): { readonly owner: string; readonly throughArea: boolean } | undefined {
  if (row !== undefined && members.has(row.owner)) return { owner: row.owner, throughArea: false };
  if (task.area === undefined || !Object.hasOwn(map.areas, task.area)) return undefined;
  const owner = map.areas[task.area];
  return owner !== undefined && members.has(owner) ? { owner, throughArea: true } : undefined;
}

/** A segment of a pattern against one of a path: `*` is any characters, the rest literal. */
function segmentMatches(part: string, segment: string): boolean {
  const chars = [...segment];
  let reach = Array.from({ length: chars.length + 1 }, (_, at) => at === 0);
  for (const wanted of part) {
    const next = Array.from({ length: chars.length + 1 }, () => false);
    if (wanted === "*") {
      let any = false;
      reach.forEach((here, at) => {
        any ||= here;
        next[at] = any;
      });
    } else chars.forEach((char, at) => void (next[at + 1] = reach[at]! && char === wanted));
    reach = next;
  }
  return reach[chars.length]!;
}

/**
 * Whether `glob` matches `path`, as coordination path patterns do: `*` within a segment, a segment
 * that is `**` any number of segments, a trailing `/` (a directory) ignored. A dynamic program over
 * both lengths, never backtracking.
 */
export function matches(glob: string, path: string): boolean {
  const segments = (path.endsWith("/") ? path.slice(0, -1) : path).split("/");
  let reach = Array.from({ length: segments.length + 1 }, (_, at) => at === 0);
  for (const part of glob.split("/")) {
    const next = Array.from({ length: segments.length + 1 }, () => false);
    if (part === "**") {
      let any = false;
      reach.forEach((here, at) => {
        any ||= here;
        next[at] = any;
      });
    } else
      segments.forEach(
        (segment, at) => void (next[at + 1] = reach[at]! && segmentMatches(part, segment)),
      );
    reach = next;
  }
  return reach[segments.length]!;
}

const codePoints = (a: string, b: string) => {
  const [left, right] = [[...a], [...b]];
  for (let at = 0; at < Math.min(left.length, right.length); at++) {
    const delta = left[at]!.codePointAt(0)! - right[at]!.codePointAt(0)!;
    if (delta !== 0) return delta;
  }
  return left.length - right.length;
};

/** The order patterns rank in, best first: more literal characters, fewer `**`, fewer other `*`, then the one that sorts first. */
function compare(a: string, b: string): number {
  const rank = (glob: string) => {
    const segments = glob.split("/");
    return [
      -[...glob].filter((char) => char !== "*").length,
      segments.filter((segment) => segment === "**").length,
      segments.reduce((count, s) => (s === "**" ? count : count + s.split("*").length - 1), 0),
    ] as const;
  };
  const [x, y] = [rank(a), rank(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || codePoints(a, b);
}

/** The owner of the most specific pattern of the map's paths that matches `path`, and that pattern. */
export function pathOwner(
  map: Pick<PeerOwnerMap, "paths">,
  path: string,
): { readonly pattern: string; readonly owner: string } | undefined {
  let best: { readonly pattern: string; readonly owner: string } | undefined;
  for (const [pattern, owner] of Object.entries(map.paths))
    if (matches(pattern, path) && (best === undefined || compare(pattern, best.pattern) < 0))
      best = { pattern, owner };
  return best;
}

/** Whether `path` matches a pattern where the owner decides changes by others. */
export const ownerDecides = (map: Pick<PeerOwnerMap, "decide">, path: string) =>
  map.decide.some((glob) => matches(glob, path));

/**
 * Whom `person`'s agent has to ask before it changes `path`: the path's owner, when the path is one
 * where the owner decides and the owner is somebody else. A path nobody owns, or where the owner does
 * not decide, needs nobody's call; an owner who left is still the one asked, and the leads decide.
 */
export function ownerToAsk(
  map: Pick<PeerOwnerMap, "paths" | "decide">,
  person: string,
  path: string,
): string | undefined {
  const owner = pathOwner(map, path)?.owner;
  return owner !== undefined && owner !== person && ownerDecides(map, path) ? owner : undefined;
}

/** What a call says of the work it is about: the session, its computer, its person and its task. */
export interface CallSession {
  readonly id: string;
  readonly email: string;
  readonly environment: string;
  readonly task: string | undefined;
}

type CallPart = Pick<PeerOwnerCall, "task" | "session" | "environment" | "email" | "paths">;

/** Whether `call` is about the work of `session`: its task, or, with none, that very session. */
export const about = (call: CallPart, session: CallSession) =>
  call.task === undefined
    ? call.session === session.id &&
      call.environment === session.environment &&
      call.email === session.email
    : session.task === call.task;

/** Whether `call` names `path`, or a directory (a path ending in `/`) that holds it. */
export const names = (call: Pick<PeerOwnerCall, "paths">, path: string) =>
  call.paths.some((named) => named === path || (named.endsWith("/") && path.startsWith(named)));

/** Whether an accepted call covers `path` for `session`: it is about its work and names the path. */
export const covers = (
  call: CallPart & { readonly state: string },
  session: CallSession,
  path: string,
) => call.state === "accepted" && about(call, session) && names(call, path);

/** Lockfiles and the like: nobody's work, so nobody's call (the Hub leaves them out too). */
const GENERATED: ReadonlySet<string> = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "go.sum",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
  "composer.lock",
  "Gemfile.lock",
  "flake.lock",
  ".DS_Store",
]);
export const generated = (path: string) => GENERATED.has(path.split("/").at(-1) ?? path);
