import type { PeerCoordEvent, PeerCoordSession, PeerStaleReads } from "@t3tools/contracts";

export interface CoordinationTaskName {
  readonly id: string;
  readonly title: string;
  readonly key?: string | undefined;
}

export function coordinationScopeLabel(
  scope: string,
  tasks: readonly CoordinationTaskName[],
): string {
  if (scope === "project") return "Project context";
  const id = scope.replace(/^task:/, "");
  const task = tasks.find((task) => task.id === id);
  return task === undefined ? id : [task.key, task.title].filter(Boolean).join(" · ");
}

export function coordinationActorLabel(
  event: PeerCoordEvent,
  sessions: readonly PeerCoordSession[],
): string {
  const credential = event.participants.find((participant) =>
    participant.startsWith("credential:"),
  );
  if (credential !== undefined) return `${credential.slice(11)} (automated)`;
  const session = sessions.find(
    (session) => session.id === event.session && session.environment === event.environment,
  );
  return session?.label || event.email || "Agent";
}

/**
 * The run an event's session was in, as a short reference beside its actor: the id's last six
 * characters, which are random, so two runs on a page tell apart. Undefined without a run.
 */
export function coordinationRunLabel(event: Pick<PeerCoordEvent, "run">): string | undefined {
  return event.run === undefined || event.run === "" ? undefined : `run …${event.run.slice(-6)}`;
}

export function inputReadiness(reads: PeerStaleReads): "stale" | "current" | "empty" | "unknown" {
  if (reads.stale.length > 0) return "stale";
  if (!reads.fresh || reads.reads === undefined) return "unknown";
  return reads.reads.length === 0 ? "empty" : "current";
}

export const inputReadinessLabels = {
  stale: "Update required",
  current: "Up to date",
  empty: "No recorded reads",
  unknown: "Reads unavailable",
} as const;

const labels: Record<string, string> = {
  "task-status": "Task moved",
  "task-removed": "Task removed",
  "pr-merged": "Pull request merged",
  claim: "Claimed files",
  "resource-claim": "Held a resource",
  "resource-release": "Released a resource",
  "claim-release": "Released files",
  overlap: "Overlap detected",
  note: "Coordination note",
  resolve: "Overlap resolved",
  ack: "Overlap acknowledged",
  keeper: "Context keeper changed",
  "context-write": "Shared context updated",
  "context-read": "Shared context read",
  question: "Question opened",
  handoff: "Work handed off",
  announcement: "Announcement posted",
  "announcement-withdrawn": "Announcement withdrawn",
  "announcement-credential": "Announcement credential created",
  "announcement-credential-revoked": "Announcement credential revoked",
};

export function coordinationEventLabel(event: PeerCoordEvent): string {
  const version = event.version === undefined ? "" : ` · v${event.version}`;
  return `${event.kind === "task-status" && event.status ? `Task moved to ${event.status}` : (labels[event.kind] ?? event.kind)}${version}`;
}

/** Duplicate subscription responses do not duplicate an event in the displayed history. */
export function coordinationTimeline(events: readonly PeerCoordEvent[]): PeerCoordEvent[] {
  return [...new Map(events.map((event) => [event.id, event])).values()].sort(
    (left, right) => right.at.localeCompare(left.at) || right.id.localeCompare(left.id),
  );
}

/**
 * Runs of neighbouring items that say the same thing (the same key), folded into one with how
 * often it happened; an item without a key always stands alone.
 */
export function groupRepeated<T>(
  items: readonly T[],
  key: (item: T) => string | null,
): { readonly item: T; readonly last: T; readonly count: number }[] {
  const groups: { item: T; last: T; count: number; key: string | null }[] = [];
  for (const item of items) {
    const itemKey = key(item);
    const previous = groups.at(-1);
    if (itemKey !== null && previous !== undefined && previous.key === itemKey) {
      previous.last = item;
      previous.count += 1;
    } else groups.push({ item, last: item, count: 1, key: itemKey });
  }
  return groups.map(({ item, last, count }) => ({ item, last, count }));
}

/** One changed input as a line: which input it is, the version the agent read and what it is now. */
export function staleInputLine(
  read: Pick<PeerStaleReads["stale"][number], "scope" | "readVersion" | "currentVersion">,
  tasks: readonly CoordinationTaskName[],
): string {
  return `${coordinationScopeLabel(read.scope, tasks)}: read v${read.readVersion} → ${read.currentVersion === null ? "removed" : `v${read.currentVersion}`}`;
}

export function staleInputSummary(reads: PeerStaleReads): string {
  if (reads.stale.length === 0) return inputReadinessLabels[inputReadiness(reads)];
  return (
    reads.stale
      .map(
        (read) =>
          `${read.scope.replace(/^task:/, "")} v${read.readVersion} → ${read.currentVersion === null ? "removed" : `v${read.currentVersion}`}`,
      )
      .join("; ") || "Shared inputs need checking"
  );
}
