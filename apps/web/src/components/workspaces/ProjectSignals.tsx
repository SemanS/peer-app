import { overlapTopic } from "@t3tools/client-runtime/peer/needs-you";
import type { PeerHubStatus } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { LayersIcon } from "lucide-react";

import { Badge } from "../ui/badge";
import { SignalTile, TONE_BADGE } from "./signals";
import type { PeerWebPlugin, ProjectSignal } from "./slots.types";
import type { WorkProjectNode } from "./workTree.logic";

export const OVERLAPS_ID = "peer-overlaps";

/**
 * A project's signals: its open overlaps (core: agents on the same file), then what the active
 * plugins add (knowledge to keep, memory, announcements, held resources, …).
 */
export function projectSignals(
  status: PeerHubStatus,
  project: WorkProjectNode,
  plugins: ReadonlyArray<PeerWebPlugin>,
): ReadonlyArray<ProjectSignal> {
  const overlaps = status.coordination.enabled
    ? status.coordination.overlaps.filter(
        (overlap) =>
          overlap.state === "open" &&
          overlap.workspace === project.workspace &&
          overlap.project === project.projectId,
      )
    : [];
  const first = overlaps[0];
  return [
    ...(status.coordination.enabled
      ? [
          {
            id: "overlaps",
            label: "Overlaps",
            icon: LayersIcon,
            count: overlaps.length,
            detail:
              first === undefined ? "No agents on the same file" : overlapTopic(status, first),
            tone: "coordination",
          } satisfies ProjectSignal,
        ]
      : []),
    ...plugins.flatMap((plugin) => plugin.projectSignals?.(status, project) ?? []),
  ];
}

/** The overlaps sit at the top of the Work panel; their tile and chips scroll there. */
function showOverlaps() {
  document.getElementById(OVERLAPS_ID)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/** A project's signals as tiles, two to a row, each in its color. */
export function ProjectSignals({
  status,
  project,
  plugins,
}: {
  readonly status: PeerHubStatus;
  readonly project: WorkProjectNode;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
}) {
  const navigate = useNavigate();
  const signals = projectSignals(status, project, plugins);
  if (signals.length === 0) return null;
  return (
    <section aria-label="Signals" className="flex flex-col gap-1.5">
      <p className="px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Signals
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {signals.map((signal) => (
          <SignalTile
            key={signal.id}
            icon={signal.icon}
            label={signal.label}
            count={signal.count}
            detail={signal.detail}
            tone={signal.tone}
            onOpen={
              signal.open !== undefined
                ? () => signal.open?.(navigate)
                : signal.id === "overlaps" && signal.count !== 0
                  ? showOverlaps
                  : undefined
            }
          />
        ))}
      </div>
    </section>
  );
}

/** The signals that count something, as colored chips: a project card, the Work board's strip. */
export function SignalChips({
  signals,
  onOpen,
}: {
  readonly signals: ReadonlyArray<ProjectSignal>;
  readonly onOpen?: (signal: ProjectSignal) => void;
}) {
  const counting = signals.filter((signal) => signal.count !== null && signal.count > 0);
  if (counting.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {counting.map((signal) => (
        <Badge
          key={signal.id}
          variant={TONE_BADGE[signal.tone]}
          size="sm"
          render={
            onOpen === undefined ? undefined : (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpen(signal);
                }}
              />
            )
          }
        >
          {signal.label} · {signal.count}
        </Badge>
      ))}
    </span>
  );
}
