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
import type { ProjectIconColor } from "@t3tools/contracts";
import type { LucideIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { ProjectMonogram } from "../ProjectMonogram";

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
    <span
      aria-label={`${count} ${label}`}
      className={cn(
        "inline-flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full border px-1.5 text-2xs font-semibold tabular-nums",
        TONE_SURFACE[tone],
        TONE_TEXT[tone],
      )}
    >
      {count}
    </span>
  );
}

/**
 * Project colors only say which project something is in: a square mark, never a chip. They come
 * from the project's id, so a project keeps its color on every computer, and they avoid the hues
 * the signals use.
 */
const PROJECT_COLORS: ReadonlyArray<ProjectIconColor> = [
  "indigo",
  "pink",
  "sky",
  "lime",
  "fuchsia",
  "cyan",
  "rose",
  "yellow",
];

export function projectColor(key: string): ProjectIconColor {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return PROJECT_COLORS[hash % PROJECT_COLORS.length]!;
}

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

/** One tile of a project's Signals: what it is, how many, and a line on it. */
export function SignalTile({
  icon: Icon,
  label,
  count,
  detail,
  tone,
  onOpen,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly count: number | null;
  readonly detail: string;
  readonly tone: SignalTone;
  readonly onOpen: (() => void) | undefined;
}) {
  const quiet = count === 0;
  const body = (
    <>
      <span
        className={cn(
          "flex items-center gap-1.5",
          quiet ? "text-muted-foreground" : TONE_TEXT[tone],
        )}
      >
        <Icon aria-hidden className="size-3.5 shrink-0" />
        {count === null ? null : (
          <span className="text-sm font-semibold tabular-nums">{count}</span>
        )}
      </span>
      <span className="truncate text-xs font-medium text-sidebar-foreground">{label}</span>
      <span className="truncate text-2xs text-muted-foreground">{detail}</span>
    </>
  );
  const className = cn(
    "flex min-w-0 flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left outline-none",
    quiet ? TONE_SURFACE.neutral : TONE_SURFACE[tone],
  );
  return onOpen === undefined ? (
    <div className={className}>{body}</div>
  ) : (
    <button
      type="button"
      className={cn(className, "hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring")}
      onClick={onOpen}
    >
      {body}
    </button>
  );
}
