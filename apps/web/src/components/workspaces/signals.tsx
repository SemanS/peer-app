/**
 * How Peer's work signals look, everywhere the Work views draw them: one color per kind of
 * conversation, so a chip reads the same in the sidebar, on a board card and on a task's page.
 *
 * - needs: waits on a person (approval, answer, request) — amber
 * - working: an agent runs — blue
 * - delivery: finished work, review, pull requests — green
 * - coordination: agent ↔ agent (overlaps, held resources, predicted conflicts) — orange
 * - knowledge: task context, knowledge to keep, memory — violet
 * - team: team ↔ agents (announcements, requests, watching) — teal
 */
import { projectColor } from "@t3tools/client-runtime/peer/work";

import { cn } from "../../lib/utils";
import { ProjectMonogram } from "../ProjectMonogram";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export type SignalTone =
  | "needs"
  | "working"
  | "delivery"
  | "coordination"
  | "knowledge"
  | "team"
  | "neutral";

export const TONE_TEXT: Readonly<Record<SignalTone, string>> = {
  needs: "text-warning-foreground",
  working: "text-info-foreground",
  delivery: "text-success-foreground",
  coordination: "text-peer-coordination-foreground",
  knowledge: "text-peer-knowledge-foreground",
  team: "text-peer-team-foreground",
  neutral: "text-muted-foreground",
};

/** A tinted surface with a matching hairline, for tiles and chips that carry a signal. */
export const TONE_SURFACE: Readonly<Record<SignalTone, string>> = {
  needs: "border-warning/30 bg-warning/8 dark:bg-warning/12",
  working: "border-info/30 bg-info/8 dark:bg-info/12",
  delivery: "border-success/30 bg-success/8 dark:bg-success/12",
  coordination: "border-peer-coordination/30 bg-peer-coordination/8 dark:bg-peer-coordination/12",
  knowledge: "border-peer-knowledge/30 bg-peer-knowledge/8 dark:bg-peer-knowledge/12",
  team: "border-peer-team/30 bg-peer-team/8 dark:bg-peer-team/12",
  neutral: "border-sidebar-border bg-sidebar-control-surface",
};

/** The Badge variant that carries each tone. */
export const TONE_BADGE = {
  needs: "warning",
  working: "info",
  delivery: "success",
  coordination: "coordination",
  knowledge: "knowledge",
  team: "team",
  neutral: "secondary",
} as const satisfies Readonly<Record<SignalTone, string>>;

/** A small count in a tone's color, as the project switcher and project cards show them. */
export function SignalCount({
  tone,
  count,
  label,
}: {
  readonly tone: SignalTone;
  readonly count: number;
  readonly label: string;
}) {
  if (count <= 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={`${count} ${label}`}
            className={cn(
              "inline-flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full border px-1.5 text-2xs font-semibold tabular-nums",
              TONE_SURFACE[tone],
              TONE_TEXT[tone],
            )}
          />
        }
      >
        {count}
      </TooltipTrigger>
      <TooltipPopup>
        {count} {label}
      </TooltipPopup>
    </Tooltip>
  );
}

/**
 * Project colors only say which project something is in: a square mark, never a chip. The shared
 * rule gives a project the same color on every computer and client, away from the signals' hues.
 */
export { projectColor };

export function ProjectMark({
  name,
  colorKey,
  className,
}: {
  readonly name: string;
  readonly colorKey: string;
  readonly className?: string;
}) {
  return (
    <ProjectMonogram
      text={Array.from(name.trim())[0]?.toUpperCase() ?? "?"}
      color={projectColor(colorKey)}
      className={className}
    />
  );
}
