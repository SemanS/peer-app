import type { PeerDigest } from "@t3tools/contracts";
import {
  automaticSinceFor,
  coverageNotice,
  digestTimeline,
  digestUnshown,
  projectVisitKey,
  sinceFor,
  windowLabel,
  type DigestTimelineRow,
  type DigestWindow,
  type VisitRecord,
} from "@t3tools/client-runtime/peer-digest";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState, useSyncExternalStore } from "react";

import { useOpenLink } from "../../../browser/useOpenLink";
import { cn } from "../../../lib/utils";
import { serverEnvironment } from "../../../state/server";
import { useEnvironmentQuery } from "../../../state/query";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import type { SignalTone } from "../signals";
import type { ProjectSlotProps } from "../slots.types";
import { visits } from "./visitTracker";

/** The color of each section's dot: the signal tone of what it reports. */
const SECTION_TONE: Readonly<Record<string, SignalTone>> = {
  announcements: "team",
  requests: "team",
  tasks: "neutral",
  "pull-requests": "delivery",
  contexts: "knowledge",
  knowledge: "knowledge",
  overlaps: "coordination",
};

const DOT: Readonly<Record<SignalTone, string>> = {
  needs: "bg-warning",
  working: "bg-info",
  delivery: "bg-success",
  coordination: "bg-peer-coordination",
  knowledge: "bg-peer-knowledge",
  team: "bg-peer-team",
  neutral: "bg-muted-foreground/50",
};

/** The person's visits, to know whether they were away from this project and since when. */
function useVisit(email: string): VisitRecord | null {
  return useSyncExternalStore(
    visits.subscribe,
    () => (email ? visits.get(email) : null),
    () => null,
  );
}

/** The time of an entry: the clock today, the day and clock before. */
function timeLabel(at: string, now: number): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return new Date(now).toDateString() === date.toDateString()
    ? time
    : `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}

/** What changed in a project, as one timeline: since the person was away, or a chosen window. */
export function DigestHistory(props: ProjectSlotProps) {
  return (
    <PersonDigestHistory key={`${props.environmentId}:${props.status.email ?? ""}`} {...props} />
  );
}

function PersonDigestHistory({ environmentId, status, project }: ProjectSlotProps) {
  const email = status.email ?? "";
  const visit = useVisit(email);
  const navigate = useNavigate();
  const openLink = useOpenLink(null);
  const [choice, setChoice] = useState<DigestWindow | null>(null);
  const [section, setSection] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [requestAt, setRequestAt] = useState(() => Date.now());
  const key = projectVisitKey(project.workspace, project.projectId);
  const away = !!visit?.away && !visit.away.dismissed.includes(key);
  const shown: DigestWindow = choice ?? (away ? "away" : "24h");
  const since = choice
    ? sinceFor(visit, choice, requestAt)
    : away
      ? automaticSinceFor(visit)
      : "24h";
  const query = useEnvironmentQuery(
    since
      ? serverEnvironment.peerDigest.get({
          environmentId,
          person: email,
          input: { workspace: project.workspace, project: project.projectId, since, revision },
        })
      : null,
  );
  const choose = (next: DigestWindow) => {
    setChoice(next);
    setSection(null);
    setRequestAt(() => Date.now());
    setRevision((value) => value + 1);
  };
  const who = (address: string) =>
    address === email
      ? "you"
      : (status.workspaces
          .find((w) => w.slug === project.workspace)
          ?.projects.find((p) => p.project.id === project.projectId)
          ?.project.members.find((m) => m.email === address)?.name ?? address);
  const open = (row: DigestTimelineRow) => {
    const target = row.target;
    if (target?.kind === "url") void openLink(target.url);
    else if (target?.kind === "context")
      void navigate({
        to: "/context/$workspace/$project/$scope",
        params: { workspace: project.workspace, project: project.projectId, scope: target.scope },
      });
    else if (target?.kind === "knowledge")
      void navigate({
        to: "/knowledge/$workspace/$project",
        params: { workspace: project.workspace, project: project.projectId },
      });
  };
  const windows: ReadonlyArray<DigestWindow> = [
    ...(away ? ["away" as const] : []),
    "8h",
    "24h",
    "7d",
  ];
  const digest = query.isPending || query.error ? undefined : query.data;

  return (
    <section aria-label="What changed" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1 px-1" role="group" aria-label="Time">
        {windows.map((option) => (
          <Chip key={option} pressed={shown === option} onClick={() => choose(option)}>
            {windowLabel(option)}
          </Chip>
        ))}
      </div>
      {query.isPending ? (
        <p className="px-2 text-xs text-muted-foreground">Reading what changed…</p>
      ) : null}
      {query.error ? (
        <div role="alert" className="px-2 text-xs">
          <p>{query.error}</p>
          <Button size="xs" variant="ghost" onClick={() => choose(shown)}>
            Retry
          </Button>
        </div>
      ) : null}
      {digest === null ? (
        <p className="px-2 text-xs text-muted-foreground">
          This Hub cannot summarize what changed yet.
        </p>
      ) : null}
      {digest ? (
        <Timeline
          digest={digest}
          section={section}
          now={requestAt}
          who={who}
          onSection={setSection}
          onOpen={open}
        />
      ) : null}
      {shown === "away" && away ? (
        <div className="px-1">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              if (email) visits.dismiss(email, key);
              setChoice(null);
              setSection(null);
            }}
          >
            Mark all seen
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function Timeline({
  digest,
  section,
  now,
  who,
  onSection,
  onOpen,
}: {
  readonly digest: PeerDigest;
  readonly section: string | null;
  readonly now: number;
  readonly who: (email: string) => string;
  readonly onSection: (section: string | null) => void;
  readonly onOpen: (row: DigestTimelineRow) => void;
}) {
  const sections = digest.sections.filter((s) => s.total > 0);
  if (sections.length === 0)
    return <p className="px-2 text-xs text-muted-foreground">Nothing changed in that time.</p>;
  const rows = digestTimeline(digest, who, section);
  const unshown = digestUnshown(digest, section);
  const coverage = coverageNotice(digest.coverage);
  return (
    <>
      {sections.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1 px-1" role="group" aria-label="Show">
          <Chip pressed={section === null} onClick={() => onSection(null)}>
            All
          </Chip>
          {sections.map((s) => (
            <Chip key={s.id} pressed={section === s.id} onClick={() => onSection(s.id)}>
              {s.title} <span className="tabular-nums opacity-70">{s.total}</span>
            </Chip>
          ))}
        </div>
      ) : null}
      {coverage ? <p className="px-2 text-2xs text-muted-foreground">{coverage}</p> : null}
      {digest.unavailable?.length ? (
        <p className="px-2 text-2xs text-muted-foreground">
          Some sources are unavailable: {digest.unavailable.join(", ")}
        </p>
      ) : null}
      <ul className="flex flex-col">
        {rows.map((row) => {
          const body = (
            <>
              <span className="w-10 shrink-0 pt-px text-2xs text-muted-foreground tabular-nums">
                {timeLabel(row.at, now)}
              </span>
              <span
                aria-hidden
                className={cn(
                  "mt-1.5 size-1.5 shrink-0 rounded-full",
                  DOT[SECTION_TONE[row.section] ?? "neutral"],
                )}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs text-sidebar-foreground">{row.subject}</span>
                <span className="truncate text-2xs text-muted-foreground">
                  {row.line}
                  {row.note ? ` · ${row.note}` : ""}
                </span>
              </span>
            </>
          );
          return (
            <li key={row.key} className="list-none">
              {row.target ? (
                <button
                  type="button"
                  className="flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() => onOpen(row)}
                >
                  {body}
                </button>
              ) : (
                <div className="flex min-w-0 items-start gap-2 px-2 py-1.5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      {unshown > 0 ? (
        <p className="px-2 text-2xs text-muted-foreground">
          {unshown} more {unshown === 1 ? "change" : "changes"} not listed
        </p>
      ) : null}
    </>
  );
}

function Chip({
  pressed,
  onClick,
  children,
}: {
  readonly pressed: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        "h-6 rounded-full border px-2 text-2xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        pressed
          ? "border-transparent bg-sidebar-foreground text-sidebar"
          : "border-sidebar-border text-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** How much changed while the person was away, beside the History button, until they look. */
export function DigestHistoryBadge({ environmentId, status, project }: ProjectSlotProps) {
  const email = status.email ?? "";
  const visit = useVisit(email);
  const key = projectVisitKey(project.workspace, project.projectId);
  const away = !!visit?.away && !visit.away.dismissed.includes(key);
  const since = away ? automaticSinceFor(visit) : null;
  const query = useEnvironmentQuery(
    since
      ? serverEnvironment.peerDigest.get({
          environmentId,
          person: email,
          input: { workspace: project.workspace, project: project.projectId, since, revision: 0 },
        })
      : null,
  );
  const total = query.data?.sections.reduce((sum, s) => sum + s.total, 0) ?? 0;
  return total === 0 ? null : (
    <Badge variant="secondary" size="sm">
      {total} new
    </Badge>
  );
}
