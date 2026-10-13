import type { EnvironmentId, PeerOwnershipDecision } from "@t3tools/contracts";
import { ownerName } from "@t3tools/client-runtime/peer/ownership";
import { useNavigate } from "@tanstack/react-router";
import { useState, type MouseEvent } from "react";

import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { useRelativeTimeTick } from "../../settings/settingsLayout";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { PersonMark } from "../marks";
import { PeerDialogMessage } from "../PeerDialog";
import type { TaskSlotProps } from "../slots.types";
import { below, pickFromMenu } from "../useWorkActions";
import { CallSummary } from "./CallSummary";
import { callDetails } from "./ownerCall.logic";
import { ownershipFailure } from "./failure";
import { OwnerCallDecision } from "./OwnerCallDecision";
import {
  ownerBadgeLabel,
  ownerBadgeWhy,
  ownerMenuChoices,
  taskCallChips,
  taskName,
  taskOwnerFacts,
  type CallChip,
  type TaskOwnerFacts,
} from "./ownership.logic";
import { openTeam } from "./teamNavigation";
import { taskMenu } from "./taskMenu";

/**
 * A task's owner on its page, beside its state and area: who owns it, in what words (a task owned
 * through its area says so), and a pill for each owner's call still waiting on it. For the person
 * who may change the owner the badge opens the same items as the task's menu. Plugin badges
 * render only on the task page; the board's card says the owner itself.
 */
export function OwnerBadge(props: TaskSlotProps) {
  const now = useRelativeTimeTick(60_000);
  const facts = taskOwnerFacts(props.status, {
    workspace: props.workspace,
    project: props.project?.project.id,
    task: props.task.id,
  });
  if (facts === undefined) return null;
  return (
    <>
      <OwnerChip slot={props} facts={facts} now={now} />
      {taskCallChips(facts, now).map((chip) => (
        <CallPill
          key={chip.call.id}
          environmentId={props.environmentId}
          facts={facts}
          chip={chip}
          now={now}
        />
      ))}
    </>
  );
}

function OwnerChip({
  slot,
  facts,
  now,
}: {
  readonly slot: TaskSlotProps;
  readonly facts: TaskOwnerFacts;
  readonly now: number;
}) {
  const { owner } = facts;
  const why = ownerBadgeWhy(owner, now);
  // The chip is a menu for the person who has an owner to change; the owner map, which every
  // member may see, is in the task's own menu and rides along in this one.
  const entries = ownerMenuChoices(facts.actions).length === 0 ? [] : taskMenu(slot);
  const open = async (event: MouseEvent<HTMLElement>) => {
    const choice = await pickFromMenu(
      entries.map((entry) => entry.item),
      below(event),
    );
    if (choice !== null) entries.find((entry) => entry.item.id === choice)?.run(choice);
  };
  const chip = (
    <Badge
      variant="outline"
      size="control"
      render={
        entries.length === 0 ? undefined : (
          <button type="button" aria-haspopup="menu" onClick={(event) => void open(event)} />
        )
      }
    >
      <PersonMark name={owner?.name ?? "–"} mine={owner?.mine ?? false} />
      {ownerBadgeLabel(owner)}
    </Badge>
  );
  return why === undefined ? (
    chip
  ) : (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipPopup>{why}</TooltipPopup>
    </Tooltip>
  );
}

/** One owner's call still waiting on the task: a pill that opens what it asks, and takes it back. */
function CallPill({
  environmentId,
  facts,
  chip,
  now,
}: {
  readonly environmentId: EnvironmentId;
  readonly facts: TaskOwnerFacts;
  readonly chip: CallChip;
  readonly now: number;
}) {
  const navigate = useNavigate();
  const withdraw = useAtomCommand(serverEnvironment.peerOwnership.withdraw, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<PeerOwnershipDecision | null>(null);
  const details = callDetails(facts.ownership, chip.call, now);
  return (
    <>
      <Popover>
        <PopoverTrigger
          render={<Badge variant="warning" size="control" render={<button type="button" />} />}
        >
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
          {chip.label}
        </PopoverTrigger>
        <PopoverPopup side="bottom" align="start" width="lg">
          <div className="flex flex-col gap-2.5">
            <CallSummary details={details} />
            {error === null ? null : <PeerDialogMessage tone="error">{error}</PeerDialogMessage>}
            <div className="flex flex-wrap gap-2">
              {details.actions.withdraw ? (
                <Button
                  size="sm"
                  variant="warning-outline"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    setError(null);
                    void withdraw({
                      environmentId,
                      input: {
                        workspace: facts.workspace.slug,
                        project: facts.ownership.project,
                        id: chip.call.id,
                      },
                    })
                      .then((result) => setError(ownershipFailure(result)))
                      .finally(() => setBusy(false));
                  }}
                >
                  Withdraw the call
                </Button>
              ) : null}
              {details.decisions === undefined ? null : (
                <>
                  <Button size="sm" onClick={() => setDeciding("accept")}>
                    {details.decisions.accept}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDeciding("decline")}>
                    {details.decisions.decline}
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  openTeam(navigate, {
                    workspace: facts.workspace.slug,
                    project: facts.ownership.project,
                  })
                }
              >
                Open the Team page
              </Button>
            </div>
          </div>
        </PopoverPopup>
      </Popover>
      {deciding === null ? null : (
        <OwnerCallDecision
          environmentId={environmentId}
          workspace={facts.workspace.slug}
          project={facts.ownership.project}
          call={chip.call}
          asker={ownerName(facts.ownership, chip.call.email)}
          owner={ownerName(facts.ownership, chip.call.owner)}
          onBehalf={details.actions.decide === "on-behalf"}
          task={taskName(facts.task)}
          decision={deciding}
          onClose={() => setDeciding(null)}
        />
      )}
    </>
  );
}
