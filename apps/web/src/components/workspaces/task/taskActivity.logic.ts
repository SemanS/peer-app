/**
 * A task's recent activity, in sentences: the Hub's coordination history of the task (the one the
 * review page and the task context page read) as "Ana’s agent updated the task context to v4".
 * What happened to the task comes first; claims and reads, which only fill a log, appear under
 * "All activity".
 */
import {
  coordinationEventLabel,
  coordinationTimeline,
} from "@t3tools/client-runtime/coordinationTimeline";
import type { PeerCoordEvent, PeerHubStatus } from "@t3tools/contracts";

import { personName } from "../workTree.logic";
import { harnessName } from "./taskChats.logic";
import { shortWhen } from "./taskTime.logic";

export interface ActivityRow {
  readonly id: string;
  readonly at: string;
  /** "40 min", "2 h", "Yesterday", "10 Oct". */
  readonly when: string;
  readonly what: string;
}

/** The events that say what happened to the task; the others are traffic of the agents at work. */
const HEADLINE_KINDS: ReadonlySet<string> = new Set([
  "task-status",
  "handoff",
  "context-write",
  "keeper",
  "overlap",
  "resolve",
  "question",
  "pr-merged",
  "task-removed",
]);

/** How many rows the page shows before "All activity". */
export const ACTIVITY_PREVIEW = 5;

/** Who did it, as a sentence starts: You, Claude (the person's own agent), Ana, Ana’s agent. */
function actorOf(event: PeerCoordEvent, status: PeerHubStatus, workspace: string): string {
  const credential = event.participants.find((participant) =>
    participant.startsWith("credential:"),
  );
  if (credential !== undefined) return `${credential.slice("credential:".length)} (automated)`;
  const email = event.email;
  const mine = email !== undefined && email === status.email;
  const name = email === undefined ? undefined : personName(status, workspace, email);
  const agent = event.session !== undefined && event.session !== "";
  if (!agent) return name === undefined ? "Someone" : mine ? "You" : name;
  if (!mine) return `${name ?? "A teammate"}’s agent`;
  const session = status.coordination.sessions.find(
    (candidate) =>
      candidate.id === event.session &&
      (event.environment === undefined || candidate.environment === event.environment),
  );
  return harnessName(session?.agent) ?? "Your agent";
}

function pathsOf(event: PeerCoordEvent): string {
  const shown = event.paths.slice(0, 2).join(", ");
  const more = event.paths.length - 2;
  return event.paths.length === 0 ? "" : more > 0 ? `${shown} and ${more} more` : shown;
}

/** One event as a sentence. */
export function activitySentence(
  event: PeerCoordEvent,
  status: PeerHubStatus,
  workspace: string,
): string {
  const actor = actorOf(event, status, workspace);
  const version = event.version === undefined ? "" : ` to v${event.version}`;
  switch (event.kind) {
    case "task-status":
      if (event.status === "review") return `${actor} moved the task to review`;
      if (event.status === "done") return `${actor} marked the task done`;
      if (event.status === "open" && event.fromStatus !== undefined) {
        return `${actor} reopened the task`;
      }
      return `${actor} moved the task${event.status === undefined ? "" : ` to ${event.status}`}`;
    case "handoff":
      return event.status === "done"
        ? `${actor} handed the task off as done`
        : `${actor} handed the task off for review`;
    case "context-write":
      return `${actor} updated the task context${version}`;
    case "keeper":
      return `${actor} took over keeping the task context`;
    case "context-read":
      return `${actor} read the task context${event.version === undefined ? "" : ` (v${event.version})`}`;
    case "claim": {
      const paths = pathsOf(event);
      return paths === "" ? `${actor} claimed files` : `${actor} claimed ${paths}`;
    }
    case "claim-release":
      return `${actor} released files`;
    default: {
      const label = coordinationEventLabel(event);
      const paths = pathsOf(event);
      return paths === "" ? label : `${label} · ${paths}`;
    }
  }
}

/**
 * The rows to show: what happened to the task, newest first, ending with its creation. Only the
 * first `ACTIVITY_PREVIEW` of those until `all`, which adds the claims and reads too; `expandable`
 * says whether showing all adds any row.
 */
export function activityRows(input: {
  readonly events: ReadonlyArray<PeerCoordEvent>;
  readonly status: PeerHubStatus;
  readonly workspace: string;
  /** The task's creation, which the Hub's history does not record as an event. */
  readonly created: { readonly by: string; readonly at: string; readonly area: string | null };
  readonly now: number;
  readonly all: boolean;
}): { readonly rows: ReadonlyArray<ActivityRow>; readonly expandable: boolean } {
  const { events, status, workspace, now } = input;
  const row = (event: PeerCoordEvent): ActivityRow => ({
    id: event.id,
    at: event.at,
    when: shortWhen(event.at, now),
    what: activitySentence(event, status, workspace),
  });
  const timeline = coordinationTimeline(events);
  const created: ActivityRow = {
    id: "created",
    at: input.created.at,
    when: shortWhen(input.created.at, now),
    what: `${input.created.by} created the task${input.created.area === null ? "" : ` in ${input.created.area}`}`,
  };
  const preview = [
    ...timeline.filter((event) => HEADLINE_KINDS.has(event.kind)).map(row),
    created,
  ].slice(0, ACTIVITY_PREVIEW);
  const everything = [...timeline.map(row), created];
  return { rows: input.all ? everything : preview, expandable: everything.length > preview.length };
}
