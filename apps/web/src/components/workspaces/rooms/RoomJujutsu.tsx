import { inactivePluginReason } from "@t3tools/client-runtime/peer/plugins";
import type { RoomPlace } from "@t3tools/client-runtime/peer/rooms";
import type { EnvironmentId, PeerHubStatus, PeerProjectState } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { GitCompareIcon, HistoryIcon } from "lucide-react";
import { type ComponentProps, useState } from "react";

import { Button } from "../../ui/button";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { jjView } from "../settings/projectRepositories.logic";
import { useSwitchToJujutsu } from "../useOpenWorkspaceProject";
import { useWorkData } from "../useWorkData";
import type { WorkTaskNode } from "../workTree.logic";
import { RoomAgentChanges } from "./RoomAgentDiff";

/**
 * The task as Jujutsu sees it, and the change of the agent picked in the conversation, which the
 * task's stack alone cannot say: several agents can carry their own change on one task.
 */
export function RoomJujutsu({
  agent,
  ...stack
}: {
  /** The agent picked in the conversation, with what its change needs to draw. */
  readonly agent:
    | ({ readonly label: string } & Omit<
        ComponentProps<typeof RoomAgentChanges>,
        "environmentId" | "place" | "jujutsu"
      >)
    | null;
} & ComponentProps<typeof RoomTaskJujutsu>) {
  const [show, setShow] = useState<"agent" | "task">("agent");
  const on = stack.projectState.repositories.some((repository) => repository.vcs === "jj");
  if (agent === null || !on) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <RoomTaskJujutsu {...stack} />
      </div>
    );
  }
  const { label, ...changes } = agent;
  return (
    <>
      <div className="shrink-0 border-b border-border/60 px-4 py-2">
        <ToggleGroup
          aria-label="Show"
          value={[show]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "agent" || next === "task") setShow(next);
          }}
        >
          <Toggle value="agent">{label}'s change</Toggle>
          <Toggle value="task">Task's stack</Toggle>
        </ToggleGroup>
      </div>
      {show === "agent" ? (
        <RoomAgentChanges
          {...changes}
          environmentId={stack.environmentId}
          place={stack.place}
          jujutsu
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <RoomTaskJujutsu {...stack} />
        </div>
      )}
    </>
  );
}

/**
 * Where the diff shows what the task changed, this shows how it stands: its stack, what moved under
 * it and how it lands, with the project's graph and undo a step away. A Git checkout gets the way
 * to switch, here where its absence is noticed.
 */
function RoomTaskJujutsu({
  environmentId,
  status,
  place,
  projectState,
  task,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly place: RoomPlace;
  readonly projectState: PeerProjectState;
  readonly task: WorkTaskNode;
}) {
  const navigate = useNavigate();
  const { plugins } = useWorkData();
  // The changes plugin's own section, through its slot: plugins do not import each other.
  const TaskChanges = plugins.find((plugin) => plugin.id === "changes")?.taskSections;
  const jujutsu = useSwitchToJujutsu(environmentId);
  const { workspace, project } = place;
  const repositories = projectState.repositories.map((repository) => ({
    id: repository.id,
    view: jjView(repository, status.jj),
  }));
  const on = repositories.some((repository) => repository.view.kind === "on");
  const offers = repositories.flatMap((repository) =>
    repository.view.kind === "offer"
      ? [{ id: repository.id, blocked: repository.view.blocked }]
      : [],
  );
  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:px-6">
      {on ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                void navigate({
                  to: "/changes/$workspace/$project",
                  params: { workspace, project },
                })
              }
            >
              <GitCompareIcon aria-hidden />
              All changes
            </Button>
            {inactivePluginReason(status, "jujutsu") === null ? (
              <Button
                size="xs"
                variant="outline"
                onClick={() => void navigate({ href: `/operations/${workspace}/${project}` })}
              >
                <HistoryIcon aria-hidden />
                Operations
              </Button>
            ) : null}
          </div>
          {TaskChanges === undefined ? (
            <p className="text-sm text-muted-foreground">
              Turn on Changes to see this task's changes here.
            </p>
          ) : (
            <TaskChanges
              environmentId={environmentId}
              status={status}
              workspace={workspace}
              project={projectState}
              task={task}
              onJujutsu
            />
          )}
        </>
      ) : offers.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          With Jujutsu, Peer snapshots each agent step, agents cannot rewrite each other's changes,
          and one step can be undone. <code className="font-mono text-xs">.git</code>, its remotes
          and unfinished work stay.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          This computer has no checkout of the project.
        </p>
      )}
      {jujutsu.allowed
        ? offers.map((offer) => (
            <div key={offer.id} className="flex flex-col items-start gap-1">
              <Button
                size="sm"
                variant="outline"
                disabled={jujutsu.busy || offer.blocked !== null}
                onClick={() =>
                  void jujutsu.switchTo({
                    workspace,
                    projectId: project,
                    repository: offer.id,
                  })
                }
              >
                {jujutsu.busy
                  ? "Switching…"
                  : offers.length === 1 && !on
                    ? "Switch to Jujutsu"
                    : `Switch ${offer.id} to Jujutsu`}
              </Button>
              {offer.blocked === null ? null : (
                <span className="text-xs text-muted-foreground">{offer.blocked}</span>
              )}
            </div>
          ))
        : null}
    </div>
  );
}
