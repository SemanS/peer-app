import { overlapTopic } from "@t3tools/client-runtime/peer/needs-you";
import type { PeerHubStatus } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, LayersIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { TONE_BADGE, TONE_SURFACE, TONE_TEXT } from "./signals";
import type { PeerWebPlugin, ProjectSignal } from "./slots.types";
import type { WorkProjectNode } from "./workTree.logic";

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
            // The overlap's page; with several, the one that waits longest.
            ...(first === undefined
              ? {}
              : {
                  open: (navigate) =>
                    void navigate({
                      to: "/overlap/$workspace/$project/$overlap",
                      params: {
                        workspace: first.workspace,
                        project: first.project,
                        overlap: first.id,
                      },
                    }),
                }),
          } satisfies ProjectSignal,
        ]
      : []),
    ...plugins.flatMap((plugin) => plugin.projectSignals?.(status, project) ?? []),
  ];
}

/**
 * The signals that count something and open a page, one row each in its color. What the panel
 * already shows (open overlaps, the active announcement, held resources) gets no second row.
 */
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
  const rows = projectSignals(status, project, plugins).filter(
    (signal) =>
      // Open overlaps are cards above the project, each opening its page.
      signal.id !== "overlaps" &&
      signal.open !== undefined &&
      signal.count !== null &&
      signal.count > 0,
  );
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {rows.map((signal) => {
        const Icon = signal.icon;
        return (
          <button
            key={signal.id}
            type="button"
            className={cn(
              "flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border px-2.5 text-left text-xs outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring",
              TONE_SURFACE[signal.tone],
            )}
            onClick={() => signal.open?.(navigate)}
          >
            <Icon aria-hidden className={cn("size-3.5 shrink-0", TONE_TEXT[signal.tone])} />
            <span className="min-w-0 flex-1 truncate font-medium text-sidebar-foreground">
              {signal.label}
            </span>
            <span className={cn("shrink-0 font-semibold tabular-nums", TONE_TEXT[signal.tone])}>
              {signal.count}
            </span>
            <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        );
      })}
    </div>
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
