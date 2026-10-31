import { CheckIcon, ChevronRightIcon, CircleDotIcon } from "lucide-react";

import { cn } from "../../../lib/utils";
import { Spinner } from "../../ui/spinner";
import type { RunActivity } from "./room.logic";

/** Where a run stands, under its agent's last message; opening it shows the changes beside. */
export function RoomActivity({
  activity,
  selected,
  onOpen,
}: {
  readonly activity: RunActivity;
  readonly selected: boolean;
  readonly onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "mt-1.5 flex w-full max-w-md min-w-0 flex-col gap-2 rounded-lg border p-3 text-start outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        selected ? "border-primary" : "border-border",
      )}
      onClick={onOpen}
    >
      <span className="flex min-w-0 items-center gap-2">
        {activity.kind === "working" ? (
          <span className="flex shrink-0 text-primary">
            <Spinner size="sm" />
          </span>
        ) : activity.kind === "delivered" ? (
          <CheckIcon aria-hidden className="size-3.5 shrink-0 text-success-foreground" />
        ) : (
          <CircleDotIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {activity.title}
        </span>
        <span className="ms-auto shrink-0 text-xs text-muted-foreground">{activity.word}</span>
      </span>
      <span className="text-xs text-muted-foreground">{activity.detail}</span>
      <span className="flex items-center gap-1 text-xs text-primary">
        {activity.link}
        <ChevronRightIcon aria-hidden className="size-3.5" />
      </span>
    </button>
  );
}
