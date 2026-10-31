import type { NameOf } from "@t3tools/client-runtime/peer/rooms";
import type { WorkThreadNode } from "@t3tools/client-runtime/peer/work";
import type { EnvironmentId, PeerHubStatus, PeerProjectState, PeerRun } from "@t3tools/contracts";

import { cn } from "../../../lib/utils";
import { PeerSectionLabel } from "../PeerPageHeader";
import { taskRunRows } from "../task/runs.logic";
import { StatusGlyph } from "../workStatus";
import type { WorkOpen } from "../workTree.logic";
import { roomAgentGroups, type RoomAgentRow } from "./room.logic";

/** The room's agents under the people who run them, each with its state. */
export function RoomHerdr({
  environmentId,
  status,
  projectState,
  runs,
  threads,
  me,
  now,
  nameOf,
  onOpen,
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
}) {
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
  if (groups.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">No agents here yet.</p>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
      {groups.map((group) => (
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
      ))}
    </div>
  );
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
