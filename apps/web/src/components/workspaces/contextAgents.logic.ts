import { personName } from "@t3tools/client-runtime/peer/needs-you";
import type { PeerHubStatus, PeerStaleReads, PeerWorkStatus } from "@t3tools/contracts";

/** An agent on the work a context is about, as the task context page lists it. */
export interface ContextAgent {
  readonly session: string;
  readonly environment: string | undefined;
  /** "Your agent", "Eva's agent". */
  readonly name: string;
  readonly mine: boolean;
  /** It keeps the context, or reads it. */
  readonly role: "keeps" | "reads";
  readonly status: PeerWorkStatus;
}

/**
 * The agents on a task (or on a project's work on no task): the one that keeps its shared context
 * first, then those that read it, yours before colleagues'.
 */
export function contextAgents(
  status: PeerHubStatus,
  place: { readonly workspace: string; readonly project: string; readonly scope: string },
): ReadonlyArray<ContextAgent> {
  const keeper = status.coordination.contexts.find(
    (context) =>
      context.workspace === place.workspace &&
      context.project === place.project &&
      context.scope === place.scope,
  )?.keeper?.session;
  return status.coordination.sessions
    .filter(
      (session) =>
        session.workspace === place.workspace &&
        session.project === place.project &&
        (session.task === undefined ? "project" : `task:${session.task}`) === place.scope,
    )
    .map((session): ContextAgent => {
      const mine = session.email === status.email;
      return {
        session: session.id,
        environment: session.environment,
        name: mine ? "Your agent" : `${personName(status, place.workspace, session.email)}’s agent`,
        mine,
        role: session.id === keeper ? "keeps" : "reads",
        status: session.status,
      };
    })
    .sort(
      (a, b) =>
        Number(b.role === "keeps") - Number(a.role === "keeps") ||
        Number(b.mine) - Number(a.mine) ||
        a.name.localeCompare(b.name),
    );
}

/** Which version of a context an agent read, and whether a newer one is there. */
export function readState(
  reads: PeerStaleReads | null,
  scope: string,
  latest: number,
): { readonly read: number | undefined; readonly behind: boolean } {
  const stale = reads?.stale.find((entry) => entry.scope === scope);
  if (stale !== undefined) return { read: stale.readVersion, behind: true };
  const read = reads?.reads?.find((entry) => entry.scope === scope)?.version;
  return { read, behind: read !== undefined && read < latest };
}
