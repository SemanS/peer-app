import type { EnvironmentId, PeerCoordEvent, PeerCoordSession } from "@t3tools/contracts";
import {
  coordinationActorLabel,
  coordinationRunLabel,
  coordinationEventLabel,
  coordinationScopeLabel,
  coordinationTimeline,
  groupRepeated,
  type CoordinationTaskName,
} from "@t3tools/client-runtime/coordinationTimeline";
import { useState } from "react";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { DecisionChip } from "./DecisionChip";
import { eventChip } from "./DecisionChip.logic";
import { useCoordinationRefresh } from "./SharedInputs";

interface Props {
  environmentId: EnvironmentId;
  workspace: string;
  project: string;
  /** What the project is called, for the chip that says what decided an event. */
  projectName?: string;
  /** This computer's default policy, which tells its own decisions from another's. */
  computerPolicy?: string;
  task?: string;
  revision?: string | undefined;
  sessions?: readonly PeerCoordSession[];
  tasks?: readonly CoordinationTaskName[];
  /** Shown open inside another view (a tab), without its own heading. */
  embedded?: boolean;
}

const NO_SESSIONS: readonly PeerCoordSession[] = [];
const NO_TASKS: readonly CoordinationTaskName[] = [];

export function PeerCoordTimeline({
  environmentId,
  workspace,
  project,
  projectName = project,
  computerPolicy,
  task,
  revision,
  sessions = NO_SESSIONS,
  tasks = NO_TASKS,
  embedded = false,
}: Props) {
  const [expanded, setOpen] = useState(false);
  const open = embedded || expanded;
  const history = useEnvironmentQuery(
    open
      ? serverEnvironment.peerHubCoordEvents({
          environmentId,
          input: {
            workspace,
            project,
            ...(task === undefined ? {} : { task }),
            limit: 50,
            revision,
          },
        })
      : null,
  );
  useCoordinationRefresh(history.refresh);
  return (
    <section
      aria-label="Coordination history"
      className={cn("min-w-0", !embedded && "border-t border-border pt-4")}
    >
      <div
        className={cn(
          "flex flex-wrap items-center gap-3",
          embedded ? "justify-end" : "justify-between",
        )}
      >
        {embedded ? null : (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="text-sm font-medium hover:underline"
          >
            {open ? "Hide activity" : "Coordination history"}
          </button>
        )}
        {open ? (
          <Button variant="ghost" size="xs" disabled={history.isPending} onClick={history.refresh}>
            Refresh
          </Button>
        ) : null}
      </div>
      {!open ? null : history.error !== null ? (
        <p role="alert" className="mt-3 text-sm text-muted-foreground">
          {history.error}
        </p>
      ) : history.data === null ? (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          Loading history…
        </p>
      ) : history.data.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <ol className={cn("flex flex-col gap-4", embedded ? "mt-2" : "mt-4")}>
          {groupRepeated(coordinationTimeline(history.data), (event) =>
            // Repeats fold into one line; an event with a decision always stands alone.
            eventChip(event.decision, projectName, computerPolicy) === null
              ? JSON.stringify([
                  coordinationEventLabel(event),
                  coordinationActorLabel(event, sessions),
                  event.scope,
                  event.paths,
                ])
              : null,
          ).map(({ item: event, last, count }) => (
            <li key={event.id} className="min-w-0 border-l border-border pl-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-sm font-medium">
                  {coordinationEventLabel(event)}
                  {count === 1 ? null : (
                    <span className="font-normal text-muted-foreground"> · {count} times</span>
                  )}
                </span>
                <time dateTime={event.at} className="text-xs text-muted-foreground">
                  {count === 1 ? null : `${eventTime(last.at)} – `}
                  {eventTime(event.at)}
                </time>
              </div>
              <p className="mt-1 break-words text-xs text-muted-foreground">
                {[
                  coordinationActorLabel(event, sessions),
                  coordinationRunLabel(event),
                  event.scope === undefined
                    ? undefined
                    : coordinationScopeLabel(event.scope, tasks),
                  event.paths.join(", "),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <EventDecision
                decision={event.decision}
                projectName={projectName}
                computerPolicy={computerPolicy}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** What decided the request an event records, when the Hub says (an older Hub does not). */
function EventDecision({
  decision,
  projectName,
  computerPolicy,
}: {
  readonly decision: PeerCoordEvent["decision"];
  readonly projectName: string;
  readonly computerPolicy: string | undefined;
}) {
  const chip = eventChip(decision, projectName, computerPolicy);
  if (chip === null) return null;
  return (
    <div className="mt-1.5 flex">
      <DecisionChip chip={chip} />
    </div>
  );
}

function eventTime(at: string): string {
  return new Date(at).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
