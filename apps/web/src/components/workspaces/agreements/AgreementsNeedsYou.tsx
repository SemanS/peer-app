import { Link } from "@tanstack/react-router";

import { cn } from "../../../lib/utils";
import { useRelativeTimeTick } from "../../settings/settingsLayout";
import { Button } from "../../ui/button";
import { TONE_SURFACE } from "../signals";
import type { NeedsYouSlotProps, PeerSlotProps } from "../slots.types";
import { AgreementWords } from "./AgreementWords";
import {
  dueCards,
  dueForMeGroups,
  peopleOf,
  projectTasks,
  type DueCard,
  type DueGroup,
} from "./agreements.logic";
import { useAgreementActions } from "./useAgreementActions";
import { useAgreementsView } from "./useAgreementsView";

/**
 * The agreements that fell due on a task no agent works on, where the person's agent took part, in
 * Needs you: a card each, with the task, the one that landed, who settled it and when, the words,
 * and what to do: Handled, which closes it, or Open task. What waits is the status field's say (it
 * knows which tasks have a live agent); a card is there only while the Hub's view still holds the
 * agreement as due, and it leaves when the agreement closes or an agent on the task has heard it.
 */
export function AgreementsNeedsYou({ environmentId, status }: NeedsYouSlotProps) {
  const groups = dueForMeGroups(status);
  if (groups.length === 0) return null;
  return <DueList environmentId={environmentId} status={status} groups={groups} />;
}

function DueList({
  environmentId,
  status,
  groups,
}: PeerSlotProps & { readonly groups: ReadonlyArray<DueGroup> }) {
  // The cards say how long ago it was settled; a minute is as fine as that gets.
  const now = useRelativeTimeTick(60_000);
  return (
    <ul aria-label="Agreements due" className="flex flex-col gap-1">
      {groups.map((group) => (
        <ProjectCards
          key={`${group.workspace}/${group.project}`}
          environmentId={environmentId}
          status={status}
          group={group}
          now={now}
        />
      ))}
    </ul>
  );
}

/** One project's cards, read from the Hub for the project alone. */
function ProjectCards({
  environmentId,
  status,
  group,
  now,
}: PeerSlotProps & { readonly group: DueGroup; readonly now: number }) {
  const { workspace, project } = group;
  const { view, error, refresh } = useAgreementsView({ environmentId, status, workspace, project });
  const cards = dueCards({
    group,
    view,
    tasks: projectTasks(status, workspace, project),
    people: peopleOf(status, workspace),
    now,
  });
  return (
    <>
      {cards.map((card) => (
        <DueAgreement key={card.key} environmentId={environmentId} card={card} refresh={refresh} />
      ))}
      {view === undefined && error === null ? (
        <li className="list-none px-2 py-1">
          <p role="status" className="text-xs text-muted-foreground">
            Loading agreements…
          </p>
        </li>
      ) : null}
      {error === null ? null : (
        <li className="flex list-none flex-wrap items-center gap-2 px-2 py-1">
          <p role="alert" className="min-w-0 flex-1 text-xs text-destructive-foreground">
            {error}
          </p>
          <Button size="xs" variant="outline" onClick={refresh}>
            Retry
          </Button>
        </li>
      )}
    </>
  );
}

function DueAgreement({
  environmentId,
  card,
  refresh,
}: {
  readonly environmentId: PeerSlotProps["environmentId"];
  readonly card: DueCard;
  readonly refresh: () => void;
}) {
  const { workspace, project, id, task } = card;
  const { busy, error, close } = useAgreementActions({
    environmentId,
    workspace,
    project,
    id,
    onChanged: refresh,
  });
  return (
    <li
      className={cn(
        "flex min-w-0 list-none flex-col gap-1.5 rounded-lg border px-2.5 py-2",
        TONE_SURFACE.needs,
      )}
    >
      <p className="text-xs font-medium text-warning-foreground">{card.state}</p>
      <p className="min-w-0 text-sm font-medium break-words text-sidebar-foreground">
        {card.title}
      </p>
      <p className="text-xs text-muted-foreground">{card.settled}</p>
      <AgreementWords words={card.words} />
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="xs" variant="outline" disabled={busy} onClick={() => void close("handled")}>
          Handled
        </Button>
        <Button
          size="xs"
          variant="ghost-muted"
          render={
            <Link to="/task/$workspace/$project/$task" params={{ workspace, project, task }} />
          }
        >
          Open task
        </Button>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-xs text-destructive-foreground">
          {error}
        </p>
      )}
    </li>
  );
}
