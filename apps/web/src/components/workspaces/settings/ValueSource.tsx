import { LaptopIcon, ServerIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../../lib/utils";
import { InlineButton } from "../../ui/button";
import { PersonMark } from "../marks";
import { ProjectMark } from "../signals";

/**
 * Where a value comes from, as the mark before its description: a project's or the workspace's own
 * mark (the colour comes from `colorKey`, `<workspace>/<project>` or the workspace's slug), a laptop
 * for this computer, a server for the Hub, a person's initial for what they chose themselves.
 */
export type ValueSourceFrom =
  | { readonly kind: "project"; readonly name: string; readonly colorKey: string }
  | { readonly kind: "workspace"; readonly name: string; readonly colorKey: string }
  | { readonly kind: "computer" }
  | { readonly kind: "hub" }
  | { readonly kind: "me"; readonly name: string };

/**
 * `ok` is what counts; `off` is set but beaten by something stronger, so struck through; `warn`
 * does not work as set, and the source says why.
 */
export type ValueSourceTone = "ok" | "off" | "warn";

const FRAME: Readonly<Record<ValueSourceTone, string>> = {
  ok: "border-border",
  off: "border-border",
  warn: "border-warning/45",
};

const VALUE: Readonly<Record<ValueSourceTone, string>> = {
  ok: "text-foreground",
  off: "text-muted-foreground line-through",
  warn: "text-warning-foreground",
};

const TONE_NOTE: Readonly<Record<ValueSourceTone, string | null>> = {
  ok: null,
  off: "Overridden: ",
  warn: "Does not work as set: ",
};

function SourceMark({ from }: { readonly from: ValueSourceFrom }) {
  switch (from.kind) {
    case "project":
    case "workspace":
      return <ProjectMark name={from.name} colorKey={from.colorKey} className="size-3.5" />;
    case "me":
      return <PersonMark name={from.name} mine />;
    case "computer":
      return <LaptopIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />;
    case "hub":
      return <ServerIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />;
  }
}

/**
 * A value and where it comes from: `coordinate · B from Booking`, then a Change link where it can be
 * changed. One pattern for every value that can come from more than one place (design artboard 02),
 * so a setting that does not apply says so on the spot.
 */
export function ValueSource({
  value,
  from,
  source,
  tone = "ok",
  change,
}: {
  readonly value: ReactNode;
  readonly from: ValueSourceFrom;
  /** What the source is in words: "from Booking", "your computer", "path rules are off on this Hub". */
  readonly source: ReactNode;
  readonly tone?: ValueSourceTone;
  /** Where the value changes; without it the value is shown and nothing more. */
  readonly change?: { readonly onClick: () => void; readonly label?: string };
}) {
  const note = TONE_NOTE[tone];
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
      <span
        className={cn(
          "inline-flex min-h-6.5 max-w-full min-w-0 items-center gap-1.5 rounded-md border bg-card px-2.5",
          FRAME[tone],
        )}
      >
        <span className={cn("font-semibold", VALUE[tone])}>
          {note === null ? null : <span className="sr-only">{note}</span>}
          {value}
        </span>
        <span aria-hidden className="text-muted-foreground/60">
          ·
        </span>
        <SourceMark from={from} />
        <span className="min-w-0 text-muted-foreground">{source}</span>
      </span>
      {change === undefined ? null : (
        <InlineButton tone="muted" onClick={change.onClick}>
          {change.label ?? "Change"}
        </InlineButton>
      )}
    </span>
  );
}
