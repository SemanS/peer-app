import type { NameOf, RoomPlace } from "@t3tools/client-runtime/peer/rooms";
import type { WorkThreadNode } from "@t3tools/client-runtime/peer/work";
import type { EnvironmentId, PeerHubStatus, PeerProjectState, PeerRun } from "@t3tools/contracts";

import { cn } from "../../../lib/utils";
import { PeerSectionLabel } from "../PeerPageHeader";
import { useProjectSets } from "../projectSets";
import { setOfProject } from "../projectSets.logic";
import { taskRunRows } from "../task/runs.logic";
import { useWorkData } from "../useWorkData";
import { useWorkScope } from "../workScope";
import { StatusGlyph } from "../workStatus";
import { projectScopeKey } from "../workBoard.logic";
import type { WorkOpen, WorkProjectNode } from "../workTree.logic";
import {
  projectAgentGroups,
  roomAgentGroups,
  type RoomAgentGroup,
  type RoomAgentRow,
} from "./room.logic";

/**
 * The room's agents under the people who run them, each with its state; in a project set, the
 * agents of its other projects under them, since the work there moves with this task.
 */
export function RoomAgents({
  environmentId,
  status,
  projectState,
  runs,
  threads,
  me,
  now,
  nameOf,
  onOpen,
  place,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly projectState: PeerProjectState;
  readonly runs: ReadonlyArray<PeerRun>;
  readonly threads: ReadonlyArray<WorkThreadNode>;
  readonly me: string;
  readonly now: number;
  readonly nameOf: NameOf;
  readonly onOpen: (open: WorkOpen) => void;
  readonly place: RoomPlace;
}) {
  const { tree } = useWorkData();
  const [sets] = useProjectSets();
  const [stored] = useWorkScope();
  const here = projectScopeKey({ workspace: place.workspace, projectId: place.project });
  const others = new Set(setOfProject(here, stored, sets)?.projects);
  others.delete(here);
  const rows = taskRunRows(runs, {
    me,
    now,
    manages: false,
    environmentId,
    agents: status.agents.list,
    project: projectState,
    clock: (at) => at,
  });
  const groups = roomAgentGroups({ runs, rows, threads, me, nameOf });
  const elsewhere = tree.filter((project) => others.has(projectScopeKey(project)));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
      {groups.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">No agents here yet.</p>
      ) : (
        <AgentGroups groups={groups} onOpen={onOpen} />
      )}
      {elsewhere.map((project) => (
        <section
          key={projectScopeKey(project)}
          aria-label={project.name}
          className="flex flex-col gap-3 border-t border-border/60 pt-4"
        >
          <h3 className="text-sm font-medium text-foreground">{project.name}</h3>
          <ProjectAgents project={project} me={me} nameOf={nameOf} onOpen={onOpen} />
        </section>
      ))}
    </div>
  );
}

/** A project's agents on all its work, for a project set's views. */
export function ProjectAgents({
  project,
  me,
  nameOf,
  onOpen,
}: {
  readonly project: WorkProjectNode;
  readonly me: string;
  readonly nameOf: NameOf;
  readonly onOpen: (open: WorkOpen) => void;
}) {
  const groups = projectAgentGroups(project, me, nameOf);
  return groups.length === 0 ? (
    <p className="text-sm text-muted-foreground">No agents here yet.</p>
  ) : (
    <AgentGroups groups={groups} onOpen={onOpen} />
  );
}

function AgentGroups({
  groups,
  onOpen,
}: {
  readonly groups: ReadonlyArray<RoomAgentGroup>;
  readonly onOpen: (open: WorkOpen) => void;
}) {
  return groups.map((group) => (
    <section key={group.key} aria-label={group.person} className="flex flex-col gap-1">
      <PeerSectionLabel>{group.person}</PeerSectionLabel>
      <ul className="flex flex-col">
        {group.agents.map((agent) => (
          <li key={agent.key}>
            <AgentRow agent={agent} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </section>
  ));
}

function AgentRow({
  agent,
  onOpen,
}: {
  readonly agent: RoomAgentRow;
  readonly onOpen: (open: WorkOpen) => void;
}) {
  const { open } = agent;
  return (
    <button
      type="button"
      disabled={open === undefined}
      onClick={() => {
        if (open !== undefined) onOpen(open);
      }}
      className={cn(
        "flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm",
        open !== undefined && "cursor-pointer hover:bg-accent",
      )}
    >
      <StatusGlyph status={agent.status} stale={agent.stale} />
      <span className="min-w-0 flex-1 truncate text-foreground">
        {agent.agent}
        {agent.runtime === undefined ? null : (
          <span className="text-muted-foreground"> · {agent.runtime}</span>
        )}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{agent.state}</span>
    </button>
  );
}
