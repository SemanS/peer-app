import {
  PEER_CHALLENGE_REASON_MAX,
  type EnvironmentId,
  type PeerKnowledgeChallenges,
} from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import ChatMarkdown from "../../ChatMarkdown";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Textarea } from "../../ui/textarea";
import {
  entryTitle,
  kindLabel,
  kindPlural,
  knowledgeAreas,
  plainSummary,
  type EntryValidity,
} from "./knowledge.logic";

interface SavedKnowledgeProps {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly project: string;
  readonly entries: PeerKnowledgeChallenges["entries"];
  readonly challenged: ReadonlySet<string>;
  /** How far each entry still holds; entries it leaves out are current unless challenged. */
  readonly validity?: ReadonlyMap<string, EntryValidity>;
  readonly busy: boolean;
  readonly canChallenge: boolean;
  readonly onChallenge: (entry: string, reason: string) => Promise<boolean>;
}

type Entry = SavedKnowledgeProps["entries"][number];

const VALIDITY: Readonly<
  Record<
    EntryValidity,
    { readonly label: string; readonly variant: "success" | "warning" | "error" }
  >
> = {
  current: { label: "Current", variant: "success" },
  "needs-review": { label: "Needs review", variant: "warning" },
  challenged: { label: "Challenged", variant: "error" },
};

/**
 * What the project's agents know, for people: entries by the part of the project they are about,
 * each named, summarized in plain words and marked current, needing review (its code changed) or
 * challenged. Searching lists matches across every part.
 */
export function SavedKnowledge(props: SavedKnowledgeProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [debounced, setDebounced] = useState("");
  const [kind, setKind] = useState("all");
  const [state, setState] = useState<"all" | EntryValidity>("all");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const results = useEnvironmentQuery(
    debounced === ""
      ? null
      : serverEnvironment.peerKnowledgeChallenges({
          environmentId: props.environmentId,
          input: { workspace: props.workspace, project: props.project, query: debounced },
        }),
  );
  const validityOf = (entry: string): EntryValidity =>
    props.validity?.get(entry) ?? (props.challenged.has(entry) ? "challenged" : "current");
  const searching = search.trim() !== debounced || (debounced !== "" && results.isPending);
  const query = debounced.toLocaleLowerCase();
  const source = debounced === "" ? props.entries : (results.data?.entries ?? []);
  const entries = source.filter(
    (entry) =>
      (entry.snippet !== undefined ||
        query === "" ||
        `${entry.title} ${entry.kind} ${entry.summary ?? ""} ${(entry.paths ?? []).join(" ")} ${(entry.tags ?? []).join(" ")}`
          .toLocaleLowerCase()
          .includes(query)) &&
      (kind === "all" || entry.kind === kind) &&
      (state === "all" || validityOf(entry.id) === state),
  );
  const kinds = [...new Set(props.entries.map((entry) => entry.kind))].sort();
  const areas = knowledgeAreas(entries);
  const row = (entry: Entry) => (
    <EntryRow
      key={entry.id}
      entry={entry}
      validity={validityOf(entry.id)}
      expanded={selected === entry.id}
      busy={props.busy}
      onToggle={() => setSelected(selected === entry.id ? null : entry.id)}
    >
      <SavedEntryDetail key={entry.id} {...props} entry={entry.id} />
    </EntryRow>
  );

  return (
    <section aria-label="Saved knowledge" className="flex min-w-0 flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {props.entries.length === 1 ? "1 entry" : `${props.entries.length} entries`} the
        project&apos;s agents start from. Open one to read it; if it no longer holds, challenge it
        there.
      </p>
      {props.entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No saved knowledge yet.</p>
      ) : (
        <>
          <Input
            type="search"
            aria-label="Search saved knowledge"
            placeholder="Search content, topic or path…"
            maxLength={200}
            value={search}
            disabled={props.busy}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="group" aria-label="Knowledge kind" className="flex flex-wrap gap-1">
              {["all", ...kinds].map((value) => (
                <Button
                  key={value}
                  size="xs"
                  variant={kind === value ? "secondary" : "ghost"}
                  aria-pressed={kind === value}
                  onClick={() => setKind(value)}
                >
                  {value === "all" ? "All" : kindPlural(value)}
                </Button>
              ))}
            </div>
            <select
              aria-label="Knowledge status"
              value={state}
              onChange={(event) => setState(event.target.value as typeof state)}
              className="min-h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            >
              <option value="all">Any status</option>
              <option value="current">Current</option>
              <option value="needs-review">Needs review</option>
              <option value="challenged">Challenged</option>
            </select>
          </div>
          {debounced === "" && kind === "all" && state === "all" ? null : (
            <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
              {searching ? "Searching saved content…" : `${entries.length} matching entries`}
            </p>
          )}
          {results.data?.searchLimited ? (
            <p className="text-xs text-muted-foreground">
              Showing up to 100 content matches. Refine your search for more precise results.
            </p>
          ) : null}
          {results.error === null ? null : (
            <div role="alert" className="flex flex-col items-start gap-2">
              <p className="text-sm text-destructive-foreground">
                Search could not load: {results.error}
              </p>
              <Button size="sm" variant="outline" onClick={results.refresh}>
                Retry search
              </Button>
            </div>
          )}
          {!searching && entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved entries match this search.</p>
          ) : debounced !== "" || areas.length === 1 ? (
            <Paged entries={entries} row={row} />
          ) : (
            <ul className="flex min-w-0 flex-col gap-2">
              {areas.map((area) => (
                <Area key={area.area} area={area} row={row} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** One part of the project and what its agents know about it, folded until opened. */
function Area({
  area,
  row,
}: {
  readonly area: ReturnType<typeof knowledgeAreas<Entry>>[number];
  readonly row: (entry: Entry) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <li className="min-w-0 rounded-xl border border-border bg-card">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full min-w-0 items-center gap-3 rounded-xl px-3.5 py-2.5 text-left outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ChevronRightIcon
          aria-hidden
          className={`size-4 shrink-0 text-muted-foreground ${open ? "rotate-90" : ""}`}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-foreground">
            {area.area === "" ? "Whole project" : area.area}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {area.kinds.map(kindPlural).join(", ")}
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {area.entries.length}
        </span>
      </button>
      {open ? (
        <div id={panelId} className="border-t border-border/60 px-3.5">
          <Paged entries={area.entries} row={row} />
        </div>
      ) : null}
    </li>
  );
}

/** Entries ten at a time. */
function Paged({
  entries,
  row,
}: {
  readonly entries: ReadonlyArray<Entry>;
  readonly row: (entry: Entry) => ReactNode;
}) {
  const [visible, setVisible] = useState(10);
  return (
    <div className="flex min-w-0 flex-col gap-2 pb-2">
      <ul className="min-w-0 divide-y divide-border">{entries.slice(0, visible).map(row)}</ul>
      {entries.length > visible ? (
        <div>
          <Button size="sm" variant="outline" onClick={() => setVisible((count) => count + 10)}>
            Show more entries ({entries.length - visible} remaining)
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** An entry as people read it: what it says, whether it still holds, what it applies to. */
function EntryRow({
  entry,
  validity,
  expanded,
  busy,
  onToggle,
  children,
}: {
  readonly entry: Entry;
  readonly validity: EntryValidity;
  readonly expanded: boolean;
  readonly busy: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
}) {
  const panelId = useId();
  const summary = plainSummary(entry.snippet || entry.summary || "");
  return (
    <li className="flex min-w-0 flex-col gap-1.5 py-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <button
          type="button"
          disabled={busy}
          aria-expanded={expanded}
          aria-controls={expanded ? panelId : undefined}
          className="flex min-h-11 min-w-0 items-start gap-2 rounded-sm text-left text-sm font-semibold text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={onToggle}
        >
          <ChevronRightIcon
            aria-hidden
            className={`mt-0.5 size-4 shrink-0 ${expanded ? "rotate-90" : ""}`}
          />
          <span className="min-w-0 wrap-anywhere">{entryTitle(entry.title)}</span>
        </button>
        <Badge variant={VALIDITY[validity].variant} size="sm">
          {VALIDITY[validity].label}
        </Badge>
      </div>
      {summary === "" ? null : (
        <p className="line-clamp-2 pl-6 text-sm text-muted-foreground">{summary}</p>
      )}
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-6 text-xs text-muted-foreground">
        <Badge variant="outline" size="sm">
          {kindLabel(entry.kind)}
        </Badge>
        {entry.paths?.length ? (
          <span className="min-w-0 wrap-anywhere font-mono">{entry.paths.join(", ")}</span>
        ) : null}
        <span>
          {entry.checked === undefined ? "Never confirmed" : `Confirmed ${entry.checked}`}
        </span>
      </p>
      {expanded ? (
        <div id={panelId} className="min-w-0 pt-2 pl-6">
          {children}
        </div>
      ) : null}
    </li>
  );
}

function SavedEntryDetail({ entry, ...props }: SavedKnowledgeProps & { readonly entry: string }) {
  const detail = useEnvironmentQuery(
    serverEnvironment.peerKnowledgeEntry({
      environmentId: props.environmentId,
      input: { workspace: props.workspace, project: props.project, entry },
    }),
  );
  const [writing, setWriting] = useState(false);
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const reasonId = useId();
  if (detail.error !== null)
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-2 text-sm text-destructive-foreground"
      >
        <p>Could not read this entry: {detail.error}</p>
        <Button size="xs" variant="outline" onClick={detail.refresh}>
          Retry
        </Button>
      </div>
    );
  if (!detail.isSuccess)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading entry…
      </p>
    );
  const saved = detail.data;
  if (saved === null)
    return (
      <p className="text-sm text-muted-foreground">
        This entry is no longer available in this checkout.
      </p>
    );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="wrap-anywhere text-xs text-muted-foreground">
        From <span className="font-mono">{saved.file}</span> ·{" "}
        {saved.checked === undefined
          ? "nobody has confirmed it since it was saved"
          : `last confirmed it still holds ${saved.checked}`}
      </p>
      {saved.summary === "" ? null : (
        <p className="text-sm text-foreground">{plainSummary(saved.summary, 600)}</p>
      )}
      {saved.body === "" || saved.body === saved.summary ? null : (
        <ChatMarkdown text={saved.body} cwd={undefined} />
      )}
      {submitted || props.challenged.has(entry) ? (
        <p role="status" className="text-sm text-muted-foreground">
          This entry is challenged. Review the reasons under Review.
        </p>
      ) : (
        <>
          <div>
            <Button
              ref={trigger}
              size="sm"
              variant="outline"
              aria-expanded={writing}
              disabled={props.busy || !props.canChallenge}
              onClick={() => setWriting((value) => !value)}
            >
              Challenge this entry
            </Button>
          </div>
          {!props.canChallenge ? (
            <p className="text-xs text-muted-foreground">
              Read-only access: you cannot challenge entries here.
            </p>
          ) : null}
          {writing ? (
            <div className="flex flex-col gap-2 border-l-2 border-border pl-3">
              <label htmlFor={reasonId} className="text-sm font-medium text-foreground">
                Why does this entry no longer hold?
              </label>
              <Textarea
                id={reasonId}
                autoFocus
                maxLength={PEER_CHALLENGE_REASON_MAX}
                value={reason}
                disabled={props.busy}
                onChange={(event) => setReason(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                This flags the entry for review. Its content stays unchanged.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={props.busy || !props.canChallenge || reason.trim() === ""}
                  onClick={() => {
                    void props.onChallenge(entry, reason.trim()).then((done) => {
                      if (done) {
                        setSubmitted(true);
                        setWriting(false);
                        setReason("");
                      }
                    });
                  }}
                >
                  {props.busy ? "Submitting…" : "Submit challenge"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={props.busy}
                  onClick={() => {
                    setWriting(false);
                    setReason("");
                    trigger.current?.focus();
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
