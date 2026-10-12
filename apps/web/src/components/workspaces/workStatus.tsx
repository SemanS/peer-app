/** How a thread's, a chat's or a task's state reads across Peer's work views. */
import type { PeerWorkStatus } from "@t3tools/contracts";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleIcon,
  MessageCircleQuestionIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "../../lib/utils";
import type { StateTone } from "./taskChats.logic";

export const STATUS_LABEL: Readonly<Record<PeerWorkStatus, string>> = {
  working: "Working",
  blocked: "Needs input",
  done: "Done",
  idle: "Idle",
  unknown: "Unknown",
};

// The hues the Threads list uses: sky while working, amber while it waits on
// someone. Finished work recedes, since most threads end up there.
const STATUS_ICON: Readonly<Record<PeerWorkStatus, LucideIcon>> = {
  working: CircleDashedIcon,
  blocked: MessageCircleQuestionIcon,
  done: CircleCheckIcon,
  idle: CircleIcon,
  unknown: CircleIcon,
};
const STATUS_TONE: Readonly<Record<PeerWorkStatus, string>> = {
  working: "text-info",
  blocked: "text-warning-foreground",
  done: "text-muted-foreground",
  idle: "text-muted-foreground/60",
  unknown: "text-muted-foreground/60",
};

export function StatusGlyph({
  status,
  stale = false,
}: {
  readonly status: PeerWorkStatus;
  readonly stale?: boolean;
}) {
  const Icon = STATUS_ICON[status];
  const quiet = status === "idle" || status === "unknown";
  return (
    <span
      role="img"
      aria-label={stale ? `${STATUS_LABEL[status]} (not reported lately)` : STATUS_LABEL[status]}
      className={cn("flex size-3.5 shrink-0 items-center justify-center", stale && "opacity-50")}
    >
      <Icon aria-hidden className={cn(quiet ? "size-2.5" : "size-3.5", STATUS_TONE[status])} />
    </span>
  );
}

const DOT_FILLED: Readonly<Record<StateTone, string>> = {
  needs: "border-warning bg-warning",
  working: "border-info bg-info",
  delivery: "border-success bg-success",
  neutral: "border-muted-foreground/60 bg-muted-foreground/60",
};
const DOT_HOLLOW: Readonly<Record<StateTone, string>> = {
  needs: "border-warning",
  working: "border-info",
  delivery: "border-success",
  neutral: "border-muted-foreground/60",
};

/**
 * A state as a dot in its tone: filled while something happens or is decided, hollow while the
 * work waits on someone else or has not begun. The words beside it say the state; the dot only
 * helps a scan down the list.
 */
export function StateDot({
  tone,
  hollow = false,
  small = false,
}: {
  readonly tone: StateTone;
  readonly hollow?: boolean;
  readonly small?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "shrink-0 rounded-full border-2",
        small ? "size-1.5" : "size-2",
        (hollow ? DOT_HOLLOW : DOT_FILLED)[tone],
      )}
    />
  );
}
