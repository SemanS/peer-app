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
 * The task as Jujutsu sees it, and an agent's work: the one picked in the conversation, else the
 * last to answer. A kept state opens first and never moves; Current changes is said apart from it,
 * and where no state was kept this says so rather than showing today's lines for it.
 */
export function RoomJujutsu({
  agent,
  ...stack
}: {
  /** The agent's message to show, with what its change needs to draw. */
  readonly agent: JujutsuAgent | null;
} & ComponentProps<typeof RoomTaskJujutsu>) {
  const on = stack.projectState.repositories.some((repository) => repository.vcs === "jj");
  return agent === null || !on ? (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <RoomTaskJujutsu {...stack} />
    </div>
  ) : (
    <AgentJujutsu agent={agent} stack={stack} />
  );
}

type JujutsuAgent = {
  readonly label: string;
  readonly seq: number;
  /** Its session still works, so its current changes move. */
  readonly working: boolean;
} & Omit<ComponentProps<typeof RoomAgentChanges>, "environmentId" | "place" | "jujutsu">;

function AgentJujutsu({
  agent,
  stack,
}: {
  readonly agent: JujutsuAgent;
  readonly stack: ComponentProps<typeof RoomTaskJujutsu>;
}) {
  const [show, setShow] = useState<"snapshot" | "handoff" | "current" | "task">("snapshot");
  const { environmentId, place } = stack;
  const { label, seq, working, ...changes } = agent;
  const atMessage = useRoomSnapshot({
    environmentId,
    place,
    snapshotKey: `message-${seq}`,
    run: changes.run,
  });
  const handoff = atMessage.snapshot?.handoff;
  return (
    <>
      <div className="shrink-0 border-b border-border/60 px-4 py-2">
        <ToggleGroup
          aria-label="Show"
          value={[show]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "snapshot" || next === "handoff" || next === "current" || next === "task")
              setShow(next);
          }}
        >
          <Toggle value="snapshot">At this message</Toggle>
          {handoff === undefined ? null : <Toggle value="handoff">At handoff</Toggle>}
          <Toggle value="current">{working ? "Live changes" : "Current changes"}</Toggle>
          <Toggle value="task">Task's stack</Toggle>
        </ToggleGroup>
      </div>
      {show === "snapshot" ? (
        <RoomSnapshot
          label={label}
          read={atMessage}
          view={changes}
          onCurrent={() => setShow("current")}
        />
      ) : show === "handoff" && handoff !== undefined ? (
        <HandoffSnapshot
          environmentId={environmentId}
          place={place}
          snapshotKey={handoff}
          run={changes.run}
          label={label}
          view={changes}
          onCurrent={() => setShow("current")}
        />
      ) : show === "current" ? (
        <>
          <p className="shrink-0 border-b border-border/60 bg-muted/50 px-4 py-2 text-xs text-foreground sm:px-6">
            {working
              ? `Live: follows ${label} as it works, and is not the state at any message.`
              : `Current: where ${label}'s change stands now, not the state at any message.`}
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
  onCurrent,
}: Parameters<typeof useRoomSnapshot>[0] & {
  readonly label: string;
  readonly view: SnapshotView;
  readonly onCurrent: () => void;
}) {
  const read = useRoomSnapshot({ environmentId, place, snapshotKey, run });
  return <RoomSnapshot label={label} read={read} view={view} onCurrent={onCurrent} />;
}

function RoomSnapshot({
  label,
  read,
  view,
  onCurrent,
}: {
  readonly label: string;
  readonly read: ReturnType<typeof useRoomSnapshot>;
  readonly view: SnapshotView;
  readonly onCurrent: () => void;
}) {
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const { snapshot, error, refresh } = read;
  const [scope, setScope] = useState<"message" | "all">("message");
  if (snapshot === null || snapshot.state === "none") {
    return (
      <div className="flex flex-col items-start gap-2 px-4 py-5 sm:px-6">
        <p
          role={snapshot === null && error === null ? "status" : undefined}
          className="text-sm text-muted-foreground"
        >
          {snapshot?.reason ?? error ?? "Reading the kept state…"}
        </p>
        {snapshot === null ? null : (
          <Button size="xs" variant="outline" onClick={onCurrent}>
            Show current changes
          </Button>
        )}
      </div>
    );
  }
  const { sinceLast } = snapshot;
  const onlyThis = scope === "message" ? sinceLast : undefined;
  const shown = onlyThis ?? snapshot;
  const line = snapshotLine({ ...shown, changes: snapshot.changes });
  return (
    <>
      <div className="flex min-w-0 shrink-0 flex-col gap-1 border-b border-border/60 px-4 py-2 sm:px-6">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
          <span>Snapshot · {formatShortTimestamp(snapshot.at, timestampFormat)}</span>
          {line.change === undefined ? null : <span className="font-mono">{line.change}</span>}
          <span className="tabular-nums">{line.counts}</span>
          <span>
            {onlyThis !== undefined
              ? `since #${onlyThis.seq}`
              : sinceLast === undefined
                ? "all its work so far"
                : "all its work"}
          </span>
        </p>
        {snapshot.subject === "" ? null : (
          <p className="min-w-0 truncate text-sm text-foreground">{snapshot.subject}</p>
        )}
        {sinceLast === undefined ? null : (
          <ToggleGroup
            aria-label="Lines"
            value={[scope]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "message" || next === "all") setScope(next);
            }}
          >
            <Toggle value="message">Only this message</Toggle>
            <Toggle value="all">All its work</Toggle>
          </ToggleGroup>
        )}
      </div>
      {shown.files === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-foreground sm:px-6">
          {onlyThis !== undefined
            ? `${label} changed nothing between #${onlyThis.seq} and this message.`
            : `${label} had changed nothing in the repository at this moment.`}
        </p>
      ) : (
        <RoomDiff {...view} diff={shown.diff} error={error} onRefresh={refresh} focus={null} />
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
