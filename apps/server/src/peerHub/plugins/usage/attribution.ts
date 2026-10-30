// @effect-diagnostics nodeBuiltinImport:off - path arithmetic on a scan directory.
/**
 * Which workspace project a session's usage belongs to: the rule that keeps everything else on the
 * computer. No match is an answer, and it means the session is never reported.
 *
 * @module peerHub/plugins/usage/attribution
 */
import * as NodePath from "node:path";

import type { PeerUsageReportRow } from "@t3tools/contracts";

import {
  matchRepositories,
  type PersistedRun,
  type RepositoryManifest,
} from "../../core/state/PeerState.ts";

export interface UsagePlace {
  readonly workspace: string;
  readonly project: string;
}

export interface AttributedPlace extends UsagePlace {
  readonly capacity: PeerUsageReportRow["capacity"];
}

/** A run names its sessions `<agent>:<native id>`. */
export const sessionKey = (provider: string, sessionId: string) => `${provider}:${sessionId}`;

/** Each session this person's runs name, the newest run winning if two do. */
export function runPlaces(
  runs: ReadonlyArray<PersistedRun>,
  email: string,
): ReadonlyMap<string, UsagePlace> {
  const places = new Map<string, UsagePlace>();
  // A run's address is blank when it was made before sign-in; it is still this computer's.
  const own = runs.filter((run) => run.email === email || run.email === "");
  for (const run of own.toSorted((a, b) => a.startedAt.localeCompare(b.startedAt)))
    for (const session of run.sessions)
      places.set(session.id, { workspace: run.workspace, project: run.project });
  return places;
}

/** Shared capacity's transcripts sit in `<hubHome>/<slug>/claude/<project>`, which names both. */
export function sharedPlace(dir: string, hubHomes: ReadonlyArray<string>): UsagePlace | null {
  for (const home of hubHomes) {
    const [workspace, harness, project] = NodePath.relative(home, dir).split(NodePath.sep);
    if (workspace === undefined || workspace === "" || workspace === "..") continue;
    if (harness === "claude" && project !== undefined) return { workspace, project };
  }
  return null;
}

export interface AttributionContext {
  readonly runs: ReadonlyMap<string, UsagePlace>;
  readonly hubHomes: ReadonlyArray<string>;
  /** Every workspace of this person's, null while one has no manifest yet. */
  readonly manifests: ReadonlyArray<RepositoryManifest | null>;
  /** `origin` of a working directory; null for a directory that is gone or has none. */
  readonly remoteOf: (cwd: string) => string | null;
}

/** Whether a session needs its directory's `origin`, which is what costs a process. */
export function needsRemote(
  session: { readonly provider: string; readonly sessionId: string; readonly dir: string },
  context: Pick<AttributionContext, "runs" | "hubHomes">,
) {
  return (
    !context.runs.has(sessionKey(session.provider, session.sessionId)) &&
    sharedPlace(session.dir, context.hubHomes) === null
  );
}

function placeByRepository(
  cwd: string | undefined,
  { manifests, remoteOf }: Pick<AttributionContext, "manifests" | "remoteOf">,
): UsagePlace | null {
  // A workspace not read yet could hold the repository too, and a match in two is no match.
  if (cwd === undefined || manifests.includes(null)) return null;
  const remote = remoteOf(cwd);
  if (remote === null) return null;
  const matches = matchRepositories(remote, manifests);
  if (new Set(matches.map((match) => match.workspace)).size !== 1) return null;
  const project = matches.map((match) => match.project).toSorted()[0]!;
  return { workspace: matches[0]!.workspace, project };
}

export function attribute(
  session: {
    readonly provider: string;
    readonly sessionId: string;
    readonly cwd?: string;
    readonly dir: string;
  },
  context: AttributionContext,
): AttributedPlace | null {
  const shared = sharedPlace(session.dir, context.hubHomes);
  const place =
    (session.sessionId === ""
      ? undefined
      : context.runs.get(sessionKey(session.provider, session.sessionId))) ??
    shared ??
    placeByRepository(session.cwd, context);
  if (place === null) return null;
  // A place from a run or a folder may outlive its project, and the Hub would only refuse it.
  const known = context.manifests.some(
    (manifest) =>
      manifest?.workspace.slug === place.workspace &&
      manifest.projects.some((project) => project.id === place.project),
  );
  return known ? { ...place, capacity: shared === null ? "personal" : "shared" } : null;
}
