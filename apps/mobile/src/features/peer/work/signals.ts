import { overlapTopic } from "@t3tools/client-runtime/peer/needs-you";
import type { WorkProjectNode } from "@t3tools/client-runtime/peer/work";
import type { PeerHubStatus } from "@t3tools/contracts";

import type { PeerMobilePlugin, ProjectSignal } from "../slotTypes";

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
