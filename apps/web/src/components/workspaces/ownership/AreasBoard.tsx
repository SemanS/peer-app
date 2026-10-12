import {
  agentsLine,
  ownerLine,
  type ProjectOwnership,
  type TeamArea,
  type TeamCall,
  type TeamTask,
} from "@t3tools/client-runtime/peer/ownership";
import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";

import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../../ui/popover";
import { PersonMark } from "../marks";
import { PeerSectionLabel, TaskKey } from "../PeerPageHeader";
import { TONE_BADGE } from "../signals";
import { teamTaskFactsOf } from "../slots.logic";
import type { PeerWebPlugin } from "../slots.types";
import { StateDot } from "../WorkBoardCards";
import { taskStateTone } from "../workList.logic";
import type { WorkProjectNode } from "../workTree.logic";
import { CallSummary } from "./CallSummary";
import { callDetails } from "./ownerCall.logic";
import { openOwnerDialog } from "./ownerDialog";
import { splitCallBadges } from "./team.logic";
import { SectionNote } from "./TeamParts";

/**
 * The project's open and in-review tasks by area, in the project's order: each area with its owner
 * and what that owner decides, each task with its owner, its state in the words the board uses,
 * its agents counted by person and status (never named), and the facts that explain it: an
 * owner's call it waits on, changes its agents made in somebody else's paths, its review, an
 * overlap, and one fact from each plugin that has something to say about it. A lead or an admin
 * names a task's owner from its row; the dialog is the task page's own.
 */
export function AreasBoard({
  environmentId,
  areas,
  status,
  project,
  ownership,
  plugins,
  now,
  cleared,
}: {
  readonly environmentId: EnvironmentId;
  readonly areas: ReadonlyArray<TeamArea>;
  readonly status: PeerHubStatus;
  readonly project: WorkProjectNode;
  readonly ownership: ProjectOwnership;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly now: number;
  /** How tasks that have no owner came to have none, by task id: "Given back by Eva". */
  readonly cleared: ReadonlyMap<string, string>;
}) {
  return (
    <section aria-label="Areas and tasks" className="flex flex-col gap-3">
      <PeerSectionLabel
        after={<SectionNote>Open and in-review tasks, in the project's area order</SectionNote>}
      >
        Areas and tasks
      </PeerSectionLabel>
      {areas.length === 0 ? (
        <p className="text-sm text-muted-foreground">No task is open or in review.</p>
      ) : (
        areas.map((area) => (
          <AreaCard
            key={area.name ?? "none"}
            environmentId={environmentId}
            area={area}
            status={status}
            project={project}
            ownership={ownership}
            plugins={plugins}
            now={now}
            cleared={cleared}
          />
        ))
      )}
    </section>
  );
}

function AreaCard({
  environmentId,
  area,
  status,
  project,
  ownership,
  plugins,
  now,
  cleared,
}: {
  readonly environmentId: EnvironmentId;
  readonly area: TeamArea;
  readonly status: PeerHubStatus;
  readonly project: WorkProjectNode;
  readonly ownership: ProjectOwnership;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly now: number;
  readonly cleared: ReadonlyMap<string, string>;
}) {
  const { owner } = area;
  return (
    <section
      aria-label={area.name ?? "Not in an area"}
      className="flex flex-col overflow-hidden rounded-xl border border-border bg-card"
    >
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">{area.name ?? "Not in an area"}</h3>
        <Badge variant="outline" size="control">
          <PersonMark name={owner?.name ?? "–"} mine={owner?.mine ?? false} />
          {owner?.name ?? "No owner"}
        </Badge>
        {area.rule === undefined ? null : (
          <span className="text-sm text-muted-foreground">{area.rule}</span>
        )}
      </header>
      <ul className="flex flex-col divide-y divide-border">
        {area.tasks.map((task) => (
          <TaskRow
            key={task.id}
            environmentId={environmentId}
            task={task}
            status={status}
            project={project}
            ownership={ownership}
            plugins={plugins}
            now={now}
            cleared={cleared.get(task.id)}
          />
        ))}
      </ul>
    </section>
  );
}

function TaskRow({
  environmentId,
  task,
  status,
  project,
  ownership,
  plugins,
  now,
  cleared,
}: {
  readonly environmentId: EnvironmentId;
  readonly task: TeamTask;
  readonly status: PeerHubStatus;
  readonly project: WorkProjectNode;
  readonly ownership: ProjectOwnership;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly now: number;
  readonly cleared: string | undefined;
}) {
  const navigate = useNavigate();
  const facts = teamTaskFactsOf(plugins, {
    status,
    project,
    now,
    task: { id: task.id, key: task.key, title: task.title },
  });
  const { calls, rest } = splitCallBadges(task);
  const badges = [
    ...rest.map((badge) => ({
      key: `badge:${badge.text}`,
      text: badge.text,
      variant: badge.tone === "needs" ? ("warning" as const) : ("outline" as const),
      open: undefined,
    })),
    ...(cleared === undefined
      ? []
      : [{ key: "cleared", text: cleared, variant: "outline" as const, open: undefined }]),
    ...facts.map(({ key, fact }) => ({
      key,
      text: fact.text,
      variant: TONE_BADGE[fact.tone],
      open: fact.open,
    })),
  ];
  return (
    <li className="flex flex-col gap-2 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
        {task.key === undefined ? null : <TaskKey>{task.key}</TaskKey>}
        <Link
          to="/task/$workspace/$project/$task"
          params={{ workspace: project.workspace, project: project.projectId, task: task.id }}
          className="min-w-0 flex-1 basis-48 rounded-sm text-sm font-semibold text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {task.title}
        </Link>
        <span className="text-sm text-foreground">{ownerLine(task.owner)}</span>
        <Badge variant={TONE_BADGE[taskStateTone(task.state.kind)]} size="control">
          <StateDot kind={task.state.kind} />
          {task.state.label}
        </Badge>
        <span className="text-sm text-muted-foreground">{agentsLine(task.agents)}</span>
        {ownership.canManage ? (
          <Button
            size="xs"
            variant="ghost-muted"
            aria-label={`Set owner of ${task.key ?? task.title}`}
            onClick={() =>
              openOwnerDialog({
                kind: "set",
                environmentId,
                workspace: project.workspace,
                project: project.projectId,
                task: task.id,
              })
            }
          >
            Set owner…
          </Button>
        ) : null}
      </div>
      {badges.length + calls.length === 0 ? null : (
        <ul className="flex flex-wrap gap-1.5" aria-label={`Facts about ${task.title}`}>
          {calls.map(({ call, badge }) => (
            <li key={`call:${call.id}`}>
              <CallBadge text={badge.text} call={call} ownership={ownership} now={now} />
            </li>
          ))}
          {badges.map((badge) => (
            <li key={badge.key}>
              <Badge
                variant={badge.variant}
                size="lg"
                render={
                  badge.open === undefined ? undefined : (
                    <button type="button" onClick={() => badge.open?.(navigate)} />
                  )
                }
              >
                {badge.text}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * A call the task waits on: its badge opens what the call says, for every member (an owner's call
 * is a fact of the team's work: who asked whom to change which paths, and why). Deciding it is for
 * the task's page and the owner's Needs you.
 */
function CallBadge({
  text,
  call,
  ownership,
  now,
}: {
  readonly text: string;
  readonly call: TeamCall;
  readonly ownership: ProjectOwnership;
  readonly now: number;
}) {
  const found = ownership.view.calls.find((candidate) => candidate.id === call.id);
  if (found === undefined) {
    return (
      <Badge variant="warning" size="lg">
        {text}
      </Badge>
    );
  }
  return (
    <Popover>
      <PopoverTrigger
        render={<Badge variant="warning" size="lg" render={<button type="button" />} />}
      >
        {text}
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="start" width="lg">
        <div className="flex flex-col gap-2.5">
          <CallSummary details={callDetails(ownership, found, now)} />
        </div>
      </PopoverPopup>
    </Popover>
  );
}
