// @effect-diagnostics globalDate:off - an imported run's start is when Peer first read it.
/**
 * `persisted.assignments` from before runs: the thread keys a person put on tasks. `peer-hub.json`
 * no longer has the field; a file that still carries it is read once on load and each assignment
 * becomes a detached run (`PeerState`'s load), so nothing but runs says which task a thread is on.
 *
 * @module peerHub/core/state/legacyAssignments
 */
import type { PeerRunRuntime } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { mintRunId } from "./runIds.ts";
import type { PersistedRun } from "./PeerState.ts";

/** The field as files written before phase B of runs carry it. */
export const LegacyAssignments = Schema.Struct({
  assignments: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({ workspace: Schema.String, project: Schema.String, task: Schema.String }),
    ),
  ),
  runs: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
export type LegacyAssignments = NonNullable<typeof LegacyAssignments.Type.assignments>;

/** The runtime and agent a thread key says, for a run made from a key alone. */
export function runtimeOfKey(key: string): {
  readonly runtime: PeerRunRuntime;
  readonly agent: string;
} {
  if (key.startsWith("peer:")) return { runtime: "peer", agent: "unknown" };
  if (key.startsWith("retained:")) return { runtime: "terminal", agent: "unknown" };
  const parts = key.split(":");
  if (key.startsWith("herdr:"))
    return { runtime: "herdr", agent: parts.length >= 3 ? parts[1]! : "unknown" };
  return { runtime: "terminal", agent: parts.length >= 2 ? parts[0]! : "unknown" };
}

/**
 * The assignments, each as a detached run that keeps its key and stays on this computer (`local`):
 * the Hub never heard of them and would only refuse them.
 */
export function importAssignments(
  assignments: LegacyAssignments,
  environment: string,
  email: string | null,
  now: number,
): Record<string, PersistedRun> {
  const runs: Record<string, PersistedRun> = {};
  for (const [key, assignment] of Object.entries(assignments)) {
    const id = mintRunId(now);
    runs[id] = {
      id,
      ...assignment,
      email: email ?? "",
      environment,
      ...runtimeOfKey(key),
      ...(key.startsWith("peer:") ? { thread: key } : { keys: [key] }),
      startedAt: new Date(now).toISOString(),
      sessions: [],
      sessionsBefore: 0,
      local: true,
    };
  }
  return runs;
}
