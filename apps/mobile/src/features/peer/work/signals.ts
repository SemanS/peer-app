import { overlapTopic } from "@t3tools/client-runtime/peer/needs-you";
import type { WorkProjectNode } from "@t3tools/client-runtime/peer/work";
import type { PeerHubStatus } from "@t3tools/contracts";

import type { PeerMobilePlugin, ProjectSignal, SignalTone } from "../slotTypes";

/** A tinted surface with a matching hairline, for chips that carry a signal. */
export const TONE_SURFACE: Readonly<Record<SignalTone, string>> = {
  needs: "border-warning-border bg-warning",
  working: "border-info-border bg-info",
  delivery: "border-success-border bg-success",
  coordination: "border-peer-coordination-border bg-peer-coordination",
  knowledge: "border-peer-knowledge-border bg-peer-knowledge",
  team: "border-peer-team-border bg-peer-team",
  neutral: "border-border bg-subtle",
};

/** A signal's text, readable on its surface and on cards. */
export const TONE_TEXT: Readonly<Record<SignalTone, string>> = {
  needs: "text-warning-foreground",
  working: "text-info-foreground",
  delivery: "text-success-foreground",
  coordination: "text-peer-coordination-foreground",
  knowledge: "text-peer-knowledge-foreground",
  team: "text-peer-team-foreground",
  neutral: "text-foreground-muted",
};

/** A signal's solid color, for the dot of a state. */
export const TONE_DOT: Readonly<Record<SignalTone, string>> = {
  needs: "bg-warning-foreground",
  working: "bg-info-foreground",
  delivery: "bg-success-foreground",
  coordination: "bg-peer-coordination-foreground",
  knowledge: "bg-peer-knowledge-foreground",
  team: "bg-peer-team-foreground",
  neutral: "bg-foreground-muted",
};

/** The tint of a signal's icon, for `SymbolView`'s `tintColorClassName`. */
export const TONE_TINT: Readonly<Record<SignalTone, string>> = {
  needs: "accent-warning-foreground",
  working: "accent-info-foreground",
  delivery: "accent-success-foreground",
  coordination: "accent-peer-coordination-foreground",
  knowledge: "accent-peer-knowledge-foreground",
  team: "accent-peer-team-foreground",
  neutral: "accent-icon-muted",
};

/**
 * A project's signals: its open overlaps (core: agents on the same file), then what the active
 * plugins add (knowledge to keep, memory, announcements, held resources), as on web.
 */
export function projectSignals(
  status: PeerHubStatus,
  project: WorkProjectNode,
  plugins: ReadonlyArray<PeerMobilePlugin>,
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
            icon: "square.3.layers.3d",
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
