import { overlapTopic } from "@t3tools/client-runtime/peer/needs-you";
import type { PeerHubStatus } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { LayersIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { WorkSectionLabel } from "./marks";
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
            chip: (count) => (count === 1 ? "1 overlap" : `${count} overlaps`),
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
 * The open project's signals as tiles in their colors, two to a row: those that count something
 * and open a page, and those that open a page without a count (Memory, Team). What the project
 * shows in place (the active announcement, held resources) gets no tile, and nothing shows at
 * zero. The tile of the page that is open is marked: the route the sidebar highlights
 * (`activeThread`) is `<signal id>:<workspace>:<project>` for the pages that are a signal's own.
 */
export function SignalTiles({
  status,
  project,
  plugins,
  activeThread = null,
  show,
}: {
  readonly status: PeerHubStatus;
  readonly project: WorkProjectNode;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly activeThread?: string | null;
  /** Which signals this place shows; a tab shows the ones that belong to it. */
  readonly show?: (signal: ProjectSignal) => boolean;
}) {
  const navigate = useNavigate();
  const tiles = projectSignals(status, project, plugins).filter(
    (signal) =>
      (show === undefined || show(signal)) &&
      signal.open !== undefined &&
      (signal.count === null || signal.count > 0),
  );
  if (tiles.length === 0) return null;
  return (
    <section aria-label="Signals">
      <WorkSectionLabel>Signals</WorkSectionLabel>
      <div className="grid grid-cols-2 gap-1.5">
        {tiles.map((signal) => {
          const Icon = signal.icon;
          const current = activeThread === `${signal.id}:${project.workspace}:${project.projectId}`;
          return (
            <button
              key={signal.id}
              type="button"
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex min-w-0 flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                TONE_SURFACE[signal.tone],
                current && "ring-2 ring-foreground/20",
              )}
              onClick={() => signal.open?.(navigate)}
            >
              <span
                className={cn(
                  "flex items-center gap-1.5 text-sm font-semibold tabular-nums",
                  TONE_TEXT[signal.tone],
                )}
              >
                <Icon aria-hidden className="size-3.5 shrink-0" />
                {signal.count}
              </span>
              <span className="text-xs leading-snug font-medium text-sidebar-foreground">
                {signal.label}
              </span>
              <span className="truncate text-2xs text-muted-foreground">{signal.detail}</span>
            </button>
          );
        })}
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
          {signal.chip?.(signal.count ?? 0) ?? `${signal.label} · ${signal.count}`}
        </Badge>
      ))}
    </span>
  );
}
