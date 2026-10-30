/** What the rooms plugin adds outside its page: Needs you's count and labels, and the palette's way in. */
import type { RoomPlace } from "@t3tools/client-runtime/peer/rooms";
import type { PeerHubStatus } from "@t3tools/contracts";
import { MessagesSquareIcon } from "lucide-react";

import type { PaletteAction } from "../slots.types";

/** Needs you's share of the rooms: each message that waits and each mention. */
export const roomNeedsCount = (status: Pick<PeerHubStatus, "rooms">) =>
  (status.rooms?.waiting.length ?? 0) + (status.rooms?.mentions.length ?? 0);

const projectOf = (status: Pick<PeerHubStatus, "workspaces">, place: RoomPlace) =>
  status.workspaces
    .find((workspace) => workspace.slug === place.workspace)
    ?.projects.find((entry) => entry.project.id === place.project);

/** A task as Needs you names it: its key, else its title, else its id. */
export function roomTaskLabel(status: Pick<PeerHubStatus, "workspaces">, place: RoomPlace) {
  const task = projectOf(status, place)?.work.tasks.find((row) => row.id === place.task);
  return task?.key ?? task?.title ?? place.task;
}

/**
 * Each room with messages on an open task, for the command palette: the task's search opens the
 * task, this opens its room.
 */
export function roomPalette(
  status: Pick<PeerHubStatus, "signedIn" | "workspaces" | "rooms">,
): ReadonlyArray<PaletteAction> {
  if (!status.signedIn) return [];
  return Object.entries(status.rooms?.seqs ?? {}).flatMap(([workspace, projects]) =>
    Object.entries(projects).flatMap(([project, tasks]) =>
      Object.keys(tasks).flatMap((task): ReadonlyArray<PaletteAction> => {
        const place = { workspace, project, task };
        const state = projectOf(status, place);
        const row = state?.work.tasks.find((candidate) => candidate.id === task);
        if (state === undefined || row === undefined) return [];
        return [
          {
            value: `action:room:${workspace}:${project}:${task}`,
            title: `Open room · ${row.key ?? row.title}`,
            description: state.project.name,
            searchTerms: ["room", "conversation", row.title, ...(row.key ? [row.key] : [])],
            icon: MessagesSquareIcon,
            run: async (navigate) => {
              await navigate({ to: "/room/$workspace/$project/$task", params: place });
            },
          },
        ];
      }),
    ),
  );
}
