import type { ReactNode } from "react";

import { cn } from "../../../lib/utils";

/**
 * A person's initial in a circle: the person looking in the accent color, the others quiet. A
 * mark, not a picture: the Team page shows facts about work, so a colleague is a name and what
 * they own, never their chats.
 */
export function PersonAvatar({
  name,
  mine,
  size = "md",
}: {
  readonly name: string;
  readonly mine: boolean;
  readonly size?: "sm" | "md";
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        size === "md" ? "size-8 text-sm" : "size-5.5 text-2xs",
        mine ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
      )}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** What follows a section's name: a count or a line on what the section holds. */
export function SectionNote({ children }: { readonly children: ReactNode }) {
  return (
    <span className="text-xs font-normal tracking-normal text-muted-foreground normal-case">
      {children}
    </span>
  );
}
