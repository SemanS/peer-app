import { EyeIcon } from "lucide-react";

import type { ThreadSlotProps } from "../slots";

/** The eye on a thread its owner lets the team watch live. */
export function WatchBadge({ thread }: ThreadSlotProps) {
  if (!thread.observable) return null;
  return (
    <EyeIcon
      aria-label={thread.mine ? "The team can watch it" : "Shared to watch live"}
      className="size-3 shrink-0 text-muted-foreground"
    />
  );
}
