import { changeKeyAndTitle } from "@t3tools/client-runtime/peer/changes";
import type { RoomPlace } from "@t3tools/client-runtime/peer/rooms";
import type { EnvironmentId } from "@t3tools/contracts";
import { type ComponentProps, type ReactNode, useState } from "react";

import { useClientSettings } from "../../../hooks/useSettings";
import { cn } from "../../../lib/utils";
import { formatShortTimestamp } from "../../../timestampFormat";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { stepLine } from "./room.logic";
import { RoomDiff } from "./RoomDiff";
import { useRoomDiff, useRoomSteps } from "./useRoom";

/**
 * One agent's work as it stands: the checkout of the run a card opened, read again each time jj
 * reports its change moved, which is after every step the agent takes. On jj its steps list above
 * the diff, each showing only its own lines. A Git checkout reports no step, so it moves with the
 * task's runs and Refresh.
 */
export function RoomAgentDiff({
  environmentId,
  place,
  run,
  taskName,
  jujutsu,
  revision,
  ...view
}: {
  readonly environmentId: EnvironmentId;
  readonly place: RoomPlace;
  readonly run: string;
  /** The name a change reports its task by. */
  readonly taskName: string;
  readonly jujutsu: boolean;
  readonly revision: string;
} & Omit<ComponentProps<typeof RoomDiff>, "diff" | "error" | "onRefresh" | "focus">) {
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
  const changed = `${revision}:${moved}`;
  const [step, setStep] = useState<string | undefined>(undefined);
  const steps = useRoomSteps({ environmentId, place, run, revision: changed });
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const diff = useRoomDiff({
    environmentId,
    place,
    run,
    revision: changed,
    ...(step === undefined ? {} : { step }),
  });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
    </div>
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
