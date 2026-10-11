import type { PeerSettingsHistoryPage, PeerSettingsRevisionEntry } from "@t3tools/contracts";
import { useState } from "react";

import { useNowMinute } from "../../../hooks/useNowMinute";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomQueryRunner } from "../../../state/use-atom-query-runner";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { PeerSectionLabel } from "../PeerPageHeader";
import { failureMessage } from "../WorkspaceAccess";
import { ChangeLines } from "./ChangeLines";
import { usePeerSettings } from "./PeerSettingsContext";
import {
  HISTORY_PAGE,
  canRevert,
  joinPages,
  lockedLines,
  oldestSeq,
  proposedByOf,
  reasonOf,
  shownLines,
  sourceLabel,
} from "./historyList.logic";
import { scopeNameOf } from "./reviewChanges.logic";
import { initialOf } from "./settingsView.logic";
import { useRetained } from "./useRetained";
import { useReviewChanges } from "./useReviewChanges";
import { useSettingsView, type SettingsView } from "./useSettingsView";

/** Older pages read after the first, which belong to the revision they were read at. */
interface Older {
  readonly key: string;
  readonly revisions: ReadonlyArray<PeerSettingsRevisionEntry>;
  readonly next: number | null;
}

function Initial({ name }: { readonly name: string }) {
  return (
    <span
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
    >
      {initialOf(name)}
    </span>
  );
}

/** One revision: who saved it and when, why, what it changed, and a way to revert it. */
function RevisionRow({
  entry,
  scopeName,
  view,
  onRevert,
}: {
  readonly entry: PeerSettingsRevisionEntry;
  /** The scope the list is of; lines of other scopes name theirs. */
  readonly scopeName: string | undefined;
  readonly view: SettingsView;
  readonly onRevert: (entry: PeerSettingsRevisionEntry) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const name = view.nameOf(entry.by);
  const source = sourceLabel(entry.source);
  const reason = reasonOf(entry);
  const proposedBy = proposedByOf(entry, view.nameOf);
  const { shown, hidden } = shownLines(entry.lines, expanded);
  const locked = lockedLines(entry, view.canChange);
  const absolute = new Date(entry.at);
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Initial name={name} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-medium text-foreground">{name}</span>
          <Tooltip>
            <TooltipTrigger
              render={<time dateTime={entry.at} className="text-xs text-muted-foreground" />}
            >
              {formatRelativeTimeLabel(entry.at)}
            </TooltipTrigger>
            <TooltipPopup side="top">
              {Number.isNaN(absolute.getTime()) ? entry.at : absolute.toLocaleString()}
            </TooltipPopup>
          </Tooltip>
          {source === null ? null : (
            <Badge variant="secondary" size="sm">
              {source}
            </Badge>
          )}
          {proposedBy === null ? null : (
            <span className="text-xs text-muted-foreground">proposed by {proposedBy}</span>
          )}
          <span className="font-mono text-xs text-muted-foreground">
            revision {entry.seq} · {entry.commit.slice(0, 7)}
          </span>
        </div>
        {reason === null ? null : <p className="text-sm break-words text-foreground">{reason}</p>}
        <ChangeLines lines={shown} scopeName={scopeName} />
        {hidden > 0 || expanded ? (
          <Button
            className="self-start"
            size="micro"
            variant="ghost-muted"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Show fewer" : `Show all ${entry.lines.length} changes`}
          </Button>
        ) : null}
        {locked > 0 && canRevert(entry, view.canChange) ? (
          <p className="text-xs text-muted-foreground">
            {locked} of these {locked === 1 ? "is" : "are"} not yours to revert.
          </p>
        ) : null}
      </div>
      {canRevert(entry, view.canChange) ? (
        <Button size="xs" variant="outline" onClick={() => onRevert(entry)}>
          Revert…
        </Button>
      ) : null}
    </li>
  );
}

/**
 * The history of a workspace's settings: each revision newest first, who saved it, when, why, what
 * it changed and where it came from, with "Revert…" where the person may undo it, through the same
 * review as a save. Pass `scope` (`project:<id>`) for one project's history; without it every
 * revision the person may see is listed. Renders nothing where the settings plugin is unavailable.
 */
export function HistoryList({
  workspace,
  scope,
  scopeName,
  heading,
}: {
  readonly workspace: { readonly slug: string; readonly name: string };
  /** `workspace`, `project:<id>` or `person:<email>`; every scope without it. */
  readonly scope?: string;
  /** What the scope is called, so lines of that scope drop its name ("Booking"). */
  readonly scopeName?: string;
  /** A label over the list, shown only while the list is. */
  readonly heading?: string;
}) {
  const { environmentId, status } = usePeerSettings();
  const view = useSettingsView(workspace.slug);
  const person = status.email;
  const revision = view.revision;
  const key = `${environmentId}/${workspace.slug}/${scope ?? ""}/${revision ?? ""}`;
  const first = useEnvironmentQuery(
    view.hubHasSettings && person !== null && revision !== null
      ? serverEnvironment.peerSettings.history({
          environmentId,
          person,
          input: {
            workspace: workspace.slug,
            ...(scope === undefined ? {} : { scope }),
            limit: HISTORY_PAGE,
            revision,
          },
        })
      : null,
  );
  const page: PeerSettingsHistoryPage | null = useRetained(
    first.data,
    `${environmentId}/${workspace.slug}/${scope ?? ""}`,
  );
  const readOlder = useAtomQueryRunner(serverEnvironment.peerSettings.history, {
    reportFailure: false,
  });
  const [older, setOlder] = useState<Older | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Re-read after a revert: the view's refresh moves the revision, and the list with it.
  const review = useReviewChanges({ scope: workspace.name, onSaved: () => view.refresh() });
  useNowMinute();
  if (!view.hubHasSettings) return null;

  // Older pages belong to the revision they were read at: a newer one starts again from the top.
  const current = older !== null && older.key === key ? older : null;
  const revisions = joinPages(page?.revisions ?? [], current?.revisions ?? []);
  // There is more while the page read last says so. Until this revision's first page has been read
  // (the one on screen may be the previous revision's), there is no telling where older ones start.
  const fresh = first.data;
  const more =
    fresh === null ? false : current === null ? fresh.next != null : current.next !== null;
  const before = oldestSeq(revisions);
  const loadOlder = () => {
    if (!more || before === null || person === null) return;
    setLoading(true);
    setFailure(null);
    void readOlder({
      environmentId,
      person,
      input: {
        workspace: workspace.slug,
        ...(scope === undefined ? {} : { scope }),
        limit: HISTORY_PAGE,
        before,
      },
    })
      .then((result) => {
        if (result._tag === "Success") {
          setOlder({
            key,
            revisions: [...(current?.revisions ?? []), ...result.value.revisions],
            next: result.value.next ?? null,
          });
        } else {
          setFailure(failureMessage(result));
        }
      })
      .finally(() => setLoading(false));
  };

  return (
    <section className="flex flex-col gap-2.5">
      {heading === undefined ? null : <PeerSectionLabel>{heading}</PeerSectionLabel>}
      {page === null ? (
        <p role="status" className="text-sm text-muted-foreground">
          {first.error ?? view.error ?? "Loading the history…"}
        </p>
      ) : revisions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No changes yet.</p>
      ) : (
        <ul
          aria-label="Revisions"
          className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card"
        >
          {revisions.map((entry) => (
            <RevisionRow
              key={entry.seq}
              entry={entry}
              scopeName={scopeName}
              view={view}
              onRevert={(target) =>
                review.open(
                  { kind: "revert", workspace: workspace.slug, seq: target.seq },
                  {
                    scope: scopeNameOf(target.lines, workspace.name),
                    context: `Reverting revision ${target.seq} by ${view.nameOf(target.by)}.`,
                  },
                )
              }
            />
          ))}
        </ul>
      )}
      {failure === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      )}
      {more ? (
        <Button
          className="self-start"
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={loadOlder}
        >
          {loading ? "Loading…" : "Load older"}
        </Button>
      ) : null}
      {review.dialog}
    </section>
  );
}
