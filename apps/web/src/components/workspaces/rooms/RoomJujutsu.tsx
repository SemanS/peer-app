import { inactivePluginReason } from "@t3tools/client-runtime/peer/plugins";
import type { RoomPlace } from "@t3tools/client-runtime/peer/rooms";
import type { EnvironmentId, PeerHubStatus, PeerProjectState } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { GitCompareIcon, HistoryIcon } from "lucide-react";
import { type ComponentProps, useState } from "react";

import { useClientSettings } from "../../../hooks/useSettings";
import { formatShortTimestamp } from "../../../timestampFormat";
import { Button } from "../../ui/button";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { jjView } from "../settings/projectRepositories.logic";
import { useSwitchToJujutsu } from "../useOpenWorkspaceProject";
import { useWorkData } from "../useWorkData";
import type { WorkTaskNode } from "../workTree.logic";
import { snapshotLine } from "./room.logic";
import { RoomAgentChanges } from "./RoomAgentDiff";
import { RoomDiff } from "./RoomDiff";
import { useRoomSnapshot } from "./useRoom";

/**
 * The task as Jujutsu sees it, and the moment of the agent picked in the conversation. A kept state
 * opens first and never moves; Live changes follows the agent and is said to, and where no state
 * was kept this says so rather than showing today's lines for it.
 */
export function RoomJujutsu({
  agent,
  ...stack
}: {
  /** The agent's message picked in the conversation, with what its change needs to draw. */
  readonly agent:
    | ({
        readonly label: string;
        readonly seq: number;
        /** Its session still works, so it has live changes to follow. */
        readonly working: boolean;
      } & Omit<ComponentProps<typeof RoomAgentChanges>, "environmentId" | "place" | "jujutsu">)
    | null;
} & ComponentProps<typeof RoomTaskJujutsu>) {
  const [show, setShow] = useState<"snapshot" | "handoff" | "live" | "task">("snapshot");
  const on = stack.projectState.repositories.some((repository) => repository.vcs === "jj");
  const place = stack.place;
  const environmentId = stack.environmentId;
  const atMessage = useRoomSnapshot({
    environmentId,
    place,
    snapshotKey: `message-${agent?.seq ?? 0}`,
    run: agent?.run ?? "none",
  });
  if (agent === null || !on) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <RoomTaskJujutsu {...stack} />
      </div>
    );
  }
  const { label, seq: _seq, working, ...changes } = agent;
  const handoff = atMessage.snapshot?.handoff;
  // A session that stopped takes its Live changes with it.
  const shown = show === "live" && !working ? "snapshot" : show;
  return (
    <>
      <div className="shrink-0 border-b border-border/60 px-4 py-2">
        <ToggleGroup
          aria-label="Show"
          value={[shown]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "snapshot" || next === "handoff" || next === "live" || next === "task")
              setShow(next);
          }}
        >
          <Toggle value="snapshot">At this message</Toggle>
          {handoff === undefined ? null : <Toggle value="handoff">At handoff</Toggle>}
          {working ? <Toggle value="live">Live changes</Toggle> : null}
          <Toggle value="task">Task's stack</Toggle>
        </ToggleGroup>
      </div>
      {shown === "snapshot" ? (
        <RoomSnapshot label={label} read={atMessage} view={changes} />
      ) : shown === "handoff" && handoff !== undefined ? (
        <HandoffSnapshot
          environmentId={environmentId}
          place={place}
          snapshotKey={handoff}
          run={changes.run}
          label={label}
          view={changes}
        />
      ) : shown === "live" ? (
        <>
          <p className="shrink-0 border-b border-border/60 bg-muted/50 px-4 py-2 text-xs text-foreground sm:px-6">
            Live: follows {label} as it works, and is not the state at any message.
          </p>
          <RoomAgentChanges {...changes} environmentId={environmentId} place={place} jujutsu />
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <RoomTaskJujutsu {...stack} />
        </div>
      )}
    </>
  );
}

type SnapshotView = Omit<ComponentProps<typeof RoomDiff>, "diff" | "error" | "onRefresh" | "focus">;

function HandoffSnapshot({
  environmentId,
  place,
  snapshotKey,
  run,
  label,
  view,
}: Parameters<typeof useRoomSnapshot>[0] & {
  readonly label: string;
  readonly view: SnapshotView;
}) {
  const read = useRoomSnapshot({ environmentId, place, snapshotKey, run });
  return <RoomSnapshot label={label} read={read} view={view} />;
}

function RoomSnapshot({
  label,
  read,
  view,
}: {
  readonly label: string;
  readonly read: ReturnType<typeof useRoomSnapshot>;
  readonly view: SnapshotView;
}) {
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const { snapshot, error, refresh } = read;
  if (snapshot === null || snapshot.state === "none") {
    return (
      <p
        role={snapshot === null && error === null ? "status" : undefined}
        className="px-4 py-5 text-sm text-muted-foreground sm:px-6"
      >
        {snapshot?.reason ?? error ?? "Reading the kept state…"}
      </p>
    );
  }
  const line = snapshotLine(snapshot);
  return (
    <>
      <div className="flex min-w-0 shrink-0 flex-col gap-0.5 border-b border-border/60 px-4 py-2 sm:px-6">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
          <span>Snapshot · {formatShortTimestamp(snapshot.at, timestampFormat)}</span>
          {line.change === undefined ? null : <span className="font-mono">{line.change}</span>}
          <span className="tabular-nums">{line.counts}</span>
        </p>
        {snapshot.subject === "" ? null : (
          <p className="min-w-0 truncate text-sm text-foreground">{snapshot.subject}</p>
        )}
      </div>
      {snapshot.files === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-foreground sm:px-6">
          {label} had changed nothing in the repository at this moment.
        </p>
      ) : (
        <RoomDiff {...view} diff={snapshot.diff} error={error} onRefresh={refresh} focus={null} />
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
