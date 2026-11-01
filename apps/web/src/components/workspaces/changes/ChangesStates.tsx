import type { ReactNode } from "react";

import { Badge } from "../../ui/badge";
import { PeerCard } from "../PeerPageHeader";

/** A card of the honest states: what is wrong in a word, why, and the one next step. */
export function StateCard({
  title,
  word,
  tone = "outline",
  busy,
  children,
}: {
  readonly title: string;
  readonly word?: string | undefined;
  readonly tone?: "outline" | "warning" | "error" | "info";
  readonly busy?: boolean;
  readonly children?: ReactNode;
}) {
  return (
    <PeerCard className="w-full max-w-2xl">
      <div aria-busy={busy === true ? true : undefined} className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {word === undefined ? null : (
            <Badge variant={tone} size="sm">
              {word}
            </Badge>
          )}
        </div>
        {children}
      </div>
    </PeerCard>
  );
}
