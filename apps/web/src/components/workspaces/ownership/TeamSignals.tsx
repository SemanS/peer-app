import {
  ownerName,
  type ProjectOwnership,
  type TeamSignal,
} from "@t3tools/client-runtime/peer/ownership";
import type { EnvironmentId, PeerOwnershipDecision } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState, type MouseEvent, type ReactNode } from "react";

import { cn } from "../../../lib/utils";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { PeerCard, PeerSectionLabel } from "../PeerPageHeader";
import { TONE_SURFACE } from "../signals";
import type { TeamPluginSignalItem } from "../slots.logic";
import { below, pickFromMenu } from "../useWorkActions";
import type { WorkProjectNode } from "../workTree.logic";
import { OwnerCallDecision } from "./OwnerCallDecision";
import { openOwnerDialog } from "./ownerDialog";
import { signalAction, signalAge, type SignalAction } from "./team.logic";

/**
 * What needs a person, each with the one button that opens what resolves it: an owner's call
 * pending too long, a review waiting on its owner, an agent waiting for its person, an overlap
 * left open, a landing stopped for a missing call, a task with agents and no owner, and whatever
 * the active plugins add. With nothing to say it says that nothing waits.
 */
export function TeamSignals({
  environmentId,
  project,
  ownership,
  signals,
  pluginSignals,
  now,
}: {
  readonly environmentId: EnvironmentId;
  readonly project: WorkProjectNode;
  readonly ownership: ProjectOwnership;
  readonly signals: ReadonlyArray<TeamSignal>;
  readonly pluginSignals: ReadonlyArray<TeamPluginSignalItem>;
  readonly now: number;
}) {
  const total = signals.length + pluginSignals.length;
  return (
    <section aria-label="Needs a person" className="flex flex-col gap-2.5">
      <PeerSectionLabel
        after={
          total === 0 ? undefined : (
            <Badge variant="warning" size="sm">
              {total}
            </Badge>
          )
        }
      >
        Needs a person
      </PeerSectionLabel>
      {total === 0 ? (
        <PeerCard>
          <p className="text-sm text-muted-foreground">Nothing waits for a person.</p>
        </PeerCard>
      ) : (
        <ul
          className={cn(
            "flex flex-col divide-y divide-border overflow-hidden rounded-xl border",
            TONE_SURFACE.needs,
          )}
        >
          {signals.map((signal) => (
            <CoreSignal
              key={signal.key}
              environmentId={environmentId}
              project={project}
              ownership={ownership}
              signal={signal}
              now={now}
            />
          ))}
          {pluginSignals.map(({ key, signal }) => (
            <PluginSignal key={key} signal={signal} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** A signal's row: what it is and why, how long it has waited, and its button. */
function SignalRow({
  what,
  detail,
  age,
  children,
}: {
  readonly what: string;
  readonly detail: string;
  readonly age: string;
  readonly children: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-warning" />
      <span className="flex min-w-0 flex-1 basis-80 flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">{what}</span>
        <span className="text-sm break-words text-muted-foreground">{detail}</span>
      </span>
      <span className="min-w-14 text-right text-sm text-muted-foreground tabular-nums">{age}</span>
      {children}
    </li>
  );
}

function CoreSignal({
  environmentId,
  project,
  ownership,
  signal,
  now,
}: {
  readonly environmentId: EnvironmentId;
  readonly project: WorkProjectNode;
  readonly ownership: ProjectOwnership;
  readonly signal: TeamSignal;
  readonly now: number;
}) {
  const navigate = useNavigate();
  const [deciding, setDeciding] = useState<PeerOwnershipDecision | null>(null);
  const action = signalAction(signal, { ownership, now });
  const { workspace } = project;
  const open = async (event: MouseEvent<HTMLElement>, found: SignalAction) => {
    const { target } = found;
    switch (target.kind) {
      case "task":
        void navigate({
          to: "/task/$workspace/$project/$task",
          params: { workspace, project: project.projectId, task: target.task },
        });
        return;
      case "review":
        void navigate({
          to: "/review/$workspace/$project/$task",
          params: { workspace, project: project.projectId, task: target.task },
        });
        return;
      case "overlap":
        void navigate({
          to: "/overlap/$workspace/$project/$overlap",
          params: { workspace, project: project.projectId, overlap: target.overlap },
        });
        return;
      case "set-owner":
        openOwnerDialog({
          kind: "set",
          environmentId,
          workspace,
          project: project.projectId,
          task: target.task,
        });
        return;
      case "decide": {
        const choice = await pickFromMenu(
          [
            { id: "accept", label: target.accept },
            { id: "decline", label: target.decline },
          ],
          below(event),
        );
        if (choice === "accept" || choice === "decline") setDeciding(choice);
      }
    }
  };
  const decision = action?.target.kind === "decide" ? action.target : undefined;
  return (
    <>
      <SignalRow what={signal.what} detail={signal.detail} age={signalAge(signal.ageMs)}>
        {action === undefined ? null : (
          <Button
            size="xs"
            variant="warning-outline"
            aria-haspopup={action.target.kind === "decide" ? "menu" : undefined}
            onClick={(event) => void open(event, action)}
          >
            {action.label}
          </Button>
        )}
      </SignalRow>
      {decision === undefined || deciding === null ? null : (
        <OwnerCallDecision
          environmentId={environmentId}
          workspace={workspace}
          project={project.projectId}
          call={decision.call}
          asker={ownerName(ownership, decision.call.email)}
          owner={ownerName(ownership, decision.call.owner)}
          onBehalf={decision.onBehalf}
          task={taskNameOf(project, decision.call.task)}
          decision={deciding}
          onClose={() => setDeciding(null)}
        />
      )}
    </>
  );
}

/** The task a call is about, as the lists write it ("ORD-9"); undefined for a call on no task. */
function taskNameOf(project: WorkProjectNode, id: string | undefined): string | undefined {
  const task =
    id === undefined ? undefined : project.tasks.find((candidate) => candidate.id === id);
  return task === undefined ? undefined : (task.key ?? task.title);
}

function PluginSignal({
  signal,
  now,
}: {
  readonly signal: TeamPluginSignalItem["signal"];
  readonly now: number;
}) {
  const navigate = useNavigate();
  const since = signal.since === undefined ? Number.NaN : Date.parse(signal.since);
  return (
    <SignalRow
      what={signal.what}
      detail={signal.detail}
      age={signalAge(Number.isFinite(since) ? Math.max(0, now - since) : undefined)}
    >
      {signal.action === undefined ? null : (
        <Button size="xs" variant="warning-outline" onClick={() => signal.action?.open(navigate)}>
          {signal.action.label}
        </Button>
      )}
    </SignalRow>
  );
}
