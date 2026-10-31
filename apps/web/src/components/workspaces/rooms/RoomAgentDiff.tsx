import { changeKeyAndTitle } from "@t3tools/client-runtime/peer/changes";
import type { RoomPlace } from "@t3tools/client-runtime/peer/rooms";
import type { EnvironmentId, PeerRoomThread } from "@t3tools/contracts";
import { type ComponentProps, type ReactNode, useState } from "react";

import { useClientSettings } from "../../../hooks/useSettings";
import { cn } from "../../../lib/utils";
import { formatShortTimestamp } from "../../../timestampFormat";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { AgentTimeline } from "../AgentTimeline";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { stepLine } from "./room.logic";
import { RoomDiff } from "./RoomDiff";
import { useRoomDiff, useRoomSteps, useRoomThread } from "./useRoom";

/**
 * The agent a card opened: its thread as it stood at that message, or following it while it works,
 * and beside that its changes, read again each time jj reports its change moved, which is after
 * every step the agent takes. On jj the change is named above its steps, each showing only its own
 * lines. A Git checkout reports no step, so it moves with the task's runs and Refresh.
 */
export function RoomAgentDiff({
  until,
  ...changes
}: { readonly until: string | undefined } & RoomAgentChangesProps) {
  const { environmentId, place, run } = changes;
  const changed = useChangeRevision(changes);
  const [mode, setMode] = useState<"thread" | "changes">("thread");
  const thread = useRoomThread({ environmentId, place, run, until, revision: changed });
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-4 py-2">
        <ToggleGroup
          aria-label="Show"
          value={[mode]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "thread" || next === "changes") setMode(next);
          }}
        >
          <Toggle value="thread">Thread</Toggle>
          <Toggle value="changes">Changes</Toggle>
        </ToggleGroup>
        {mode === "thread" ? (
          <span className="text-xs text-muted-foreground">
            {until === undefined
              ? "Following it now"
              : `As it stood at ${formatShortTimestamp(until, timestampFormat)}`}
          </span>
        ) : null}
      </div>
      {mode === "thread" ? (
        <AgentThread thread={thread.thread} error={thread.error} run={run} />
      ) : (
        <RoomAgentChanges {...changes} />
      )}
    </div>
  );
}

type RoomAgentChangesProps = {
  readonly environmentId: EnvironmentId;
  readonly place: RoomPlace;
  readonly run: string;
  /** The name a change reports its task by. */
  readonly taskName: string;
  readonly jujutsu: boolean;
  readonly revision: string;
} & Omit<ComponentProps<typeof RoomDiff>, "diff" | "error" | "onRefresh" | "focus">;

/** `revision`, moved also by each step jj reports on the task's changes. */
function useChangeRevision({
  environmentId,
  place,
  taskName,
  jujutsu,
  revision,
}: Pick<RoomAgentChangesProps, "environmentId" | "place" | "taskName" | "jujutsu" | "revision">) {
  const live = useEnvironmentQuery(
    jujutsu
      ? serverEnvironment.peerChangesLive({
          environmentId,
          input: { workspace: place.workspace, project: place.project },
        })
      : null,
  );
  const moved = (live.data?.changes ?? [])
    .filter((change) => changeKeyAndTitle(change).key === taskName)
    .map((change) => change.commitId)
    .join(",");
  return `${revision}:${moved}`;
}

/** The change an agent carries: its id and subject, its steps, and the lines of one or all. */
export function RoomAgentChanges({
  environmentId,
  place,
  run,
  taskName,
  jujutsu,
  revision,
  ...view
}: RoomAgentChangesProps) {
  const changed = useChangeRevision({ environmentId, place, taskName, jujutsu, revision });
  const [step, setStep] = useState<string | undefined>(undefined);
  const { steps, change } = useRoomSteps({ environmentId, place, run, revision: changed });
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const diff = useRoomDiff({
    environmentId,
    place,
    run,
    revision: changed,
    ...(step === undefined ? {} : { step }),
  });
  return (
    <>
      {change === undefined ? null : (
        <p className="flex min-w-0 shrink-0 items-baseline gap-2 border-b border-border/60 px-4 py-2 sm:px-6">
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {change.changeId.slice(0, 8)}
          </span>
          <span className="min-w-0 truncate text-sm text-foreground">
            {change.subject === "" ? "No description yet" : change.subject}
          </span>
        </p>
      )}
      {steps.length === 0 ? null : (
        <ul
          aria-label="Steps"
          className="flex max-h-44 shrink-0 flex-col overflow-y-auto border-b border-border/60 px-2 py-1.5"
        >
          <StepRow selected={step === undefined} onSelect={() => setStep(undefined)}>
            <span className="min-w-0 truncate text-foreground">All steps</span>
          </StepRow>
          {steps.map((entry) => {
            const line = stepLine(entry);
            return (
              <StepRow
                key={entry.commit}
                selected={step === entry.commit}
                onSelect={() => setStep(entry.commit)}
              >
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {formatShortTimestamp(entry.at, timestampFormat)}
                </span>
                <span className="min-w-0 truncate font-mono text-foreground">{line.name}</span>
                <span className="ms-auto shrink-0 text-muted-foreground tabular-nums">
                  {line.counts}
                </span>
              </StepRow>
            );
          })}
        </ul>
      )}
      <RoomDiff
        {...view}
        diff={diff.diff}
        error={diff.error}
        onRefresh={diff.refresh}
        focus={null}
      />
    </>
  );
}

function AgentThread({
  thread,
  error,
  run,
}: {
  readonly thread: PeerRoomThread | null;
  readonly error: string | null;
  readonly run: string;
}) {
  if (thread === null || thread.note !== undefined) {
    return (
      <p
        role={thread === null && error === null ? "status" : undefined}
        className="px-4 py-5 text-sm text-muted-foreground sm:px-6"
      >
        {thread?.note ?? error ?? "Reading its thread…"}
      </p>
    );
  }
  return (
    <AgentTimeline
      view={{
        agentId: run,
        title: "",
        status: "unknown",
        entries: thread.entries,
        gone: false,
      }}
    />
  );
}

function StepRow({
  selected,
  onSelect,
  children,
}: {
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly children: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        className={cn(
          "flex min-h-7 w-full min-w-0 items-center gap-2 rounded-sm px-2 text-start text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          selected && "bg-accent",
        )}
        onClick={onSelect}
      >
        {children}
      </button>
    </li>
  );
}
