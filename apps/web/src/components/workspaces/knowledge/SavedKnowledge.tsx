import {
  PEER_CHALLENGE_REASON_MAX,
  type EnvironmentId,
  type PeerKnowledgeChallenges,
} from "@t3tools/contracts";
import {
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import ChatMarkdown from "../../ChatMarkdown";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Textarea } from "../../ui/textarea";
import { cn } from "../../../lib/utils";
import {
  bodyBeyondSummary,
  entryHealth,
  entryTitle,
  kindLabel,
  kindPlural,
  knowledgeAreas,
  knowledgeHealth,
  plainSummary,
  type EntryHealth,
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
  /** The changed files that put an entry up for review. */
  readonly drifted?: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly busy: boolean;
  readonly canChallenge: boolean;
  readonly onChallenge: (entry: string, reason: string) => Promise<boolean>;
  /** Records that someone checked the entry and it still holds; true once recorded. */
  readonly onConfirm: (entry: string) => Promise<boolean>;
}

type Entry = SavedKnowledgeProps["entries"][number];

const HEALTH: Readonly<
  Record<
    EntryHealth,
    {
      readonly label: string;
      readonly detail: string;
      readonly icon: LucideIcon;
      readonly tone: string;
      readonly variant: "success" | "outline" | "warning";
    }
  >
> = {
  verified: {
    label: "Verified",
    detail: "Confirmed against sources",
    icon: CircleCheckIcon,
    tone: "text-success-foreground",
    variant: "success",
  },
  unverified: {
    label: "Not verified",
    detail: "No confirmation recorded",
    icon: CircleHelpIcon,
    tone: "text-muted-foreground",
    variant: "outline",
  },
  "needs-review": {
    label: "Needs review",
    detail: "Its code changed or someone questioned it",
    icon: CircleAlertIcon,
    tone: "text-warning-foreground",
    variant: "warning",
  },
};

/**
 * What the project's agents know, for people: how far the knowledge can be trusted (verified, not
 * verified, needing review) above the entries by the part of the project they are about, each
 * named and summarized in plain words. Searching lists matches across every part.
 */
export function SavedKnowledge(props: SavedKnowledgeProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [debounced, setDebounced] = useState("");
  const [kind, setKind] = useState("all");
  const [state, setState] = useState<"all" | EntryHealth>("all");
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
  const healthOf = (entry: Entry) => entryHealth(entry, validityOf(entry.id));
  const health = knowledgeHealth(props.entries, validityOf);
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
      (state === "all" || healthOf(entry) === state),
  );
  const kinds = [...new Set(props.entries.map((entry) => entry.kind))].sort();
  const areas = knowledgeAreas(entries);
  const row = (entry: Entry) => (
    <EntryRow
      key={entry.id}
      entry={entry}
      validity={validityOf(entry.id)}
      health={healthOf(entry)}
      expanded={selected === entry.id}
      busy={props.busy}
      onToggle={() => setSelected(selected === entry.id ? null : entry.id)}
    >
      <SavedEntryDetail key={entry.id} {...props} entry={entry.id} />
    </EntryRow>
  );

  return (
    <section aria-label="Saved knowledge" className="flex min-w-0 flex-col gap-3">
      {props.entries.length === 0 ? null : (
        <section
          aria-label="Knowledge health"
          className="flex flex-col gap-3 rounded-xl border border-border p-4"
        >
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-foreground">Knowledge health</h2>
            <span className="text-xs text-muted-foreground tabular-nums">
              {props.entries.length === 1 ? "1 entry" : `${props.entries.length} entries`}
            </span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-2">
            {(["verified", "unverified", "needs-review"] as const).map((value) => {
              const { label, detail, icon: Icon, tone } = HEALTH[value];
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={state === value}
                  onClick={() => setState(state === value ? "all" : value)}
                  className={cn(
                    "flex min-w-0 flex-col items-start gap-1 rounded-lg p-3 text-left outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    state === value && "bg-accent/60",
                  )}
                >
                  <Icon aria-hidden className={cn("size-4", tone)} />
                  <span className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-foreground">{label}</span>
                    <span className="text-lg font-semibold text-foreground tabular-nums">
                      {health[value]}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">{detail}</span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Current only means nobody marked an entry outdated; verified means someone confirmed it
            still holds. Pick a group to list only its entries.
          </p>
        </section>
      )}
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
  health,
  expanded,
  busy,
  onToggle,
  children,
}: {
  readonly entry: Entry;
  readonly validity: EntryValidity;
  readonly health: EntryHealth;
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
        {validity === "challenged" ? (
          <Badge variant="error" size="sm">
            Challenged
          </Badge>
        ) : (
          <Badge variant={HEALTH[health].variant} size="sm">
            {HEALTH[health].label}
          </Badge>
        )}
      </div>
      {summary === "" || expanded ? null : (
        <p className="line-clamp-2 pl-6 text-sm text-muted-foreground">{summary}</p>
      )}
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-6 text-xs text-muted-foreground">
        <Badge variant="outline" size="sm">
          {kindLabel(entry.kind)}
        </Badge>
        {entry.paths?.length ? (
          <span className="min-w-0 wrap-anywhere font-mono">{entry.paths.join(", ")}</span>
        ) : null}
        {entry.checked === undefined ? null : (
          <span>
            {health === "verified" ? "Verified" : "Last verified"} {entry.checked}
          </span>
        )}
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
  const [reviewing, setReviewing] = useState(false);
  const [choice, setChoice] = useState<"correction" | "outdated" | null>(null);
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState<"confirmed" | "correction" | "outdated" | null>(null);
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

  const changed = props.drifted?.get(entry) ?? [];
  const details = bodyBeyondSummary(saved.body, saved.title, saved.summary);
  const paths = props.entries.find((candidate) => candidate.id === entry)?.paths ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {changed.length === 0 ? null : (
        <div
          role="status"
          className="flex flex-col gap-1.5 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm"
        >
          <p className="font-medium text-foreground">Knowledge may need review</p>
          <p className="text-muted-foreground">
            {changed.length === 1 ? "A related source file" : "Related source files"} changed since
            this was last verified. A change is a reason to check, not proof it is wrong.
          </p>
          <ul className="flex flex-col font-mono text-xs text-foreground">
            {changed.map((path) => (
              <li key={path} className="wrap-anywhere">
                {path}
              </li>
            ))}
          </ul>
        </div>
      )}
      {saved.summary === "" ? null : (
        <DetailPart title={kindLabel(saved.kind)}>
          <p className="text-sm text-foreground">{plainSummary(saved.summary, 600)}</p>
        </DetailPart>
      )}
      {details === "" ? null : (
        <DetailPart title="Details">
          <ChatMarkdown text={details} cwd={undefined} />
        </DetailPart>
      )}
      {paths.length === 0 ? null : (
        <DetailPart title="Applies to">
          <p className="wrap-anywhere font-mono text-xs text-foreground">{paths.join(", ")}</p>
        </DetailPart>
      )}
      <DetailPart title="Verification">
        <p className="text-sm text-foreground">
          {saved.checked === undefined
            ? "Not verified: nobody has confirmed it still holds since it was saved."
            : `Last confirmed it still holds on ${saved.checked}.`}
        </p>
      </DetailPart>
      <DetailPart title="Source">
        <p className="wrap-anywhere font-mono text-xs text-muted-foreground">{saved.file}</p>
      </DetailPart>
      {submitted !== null || props.challenged.has(entry) ? (
        <p role="status" className="text-sm text-muted-foreground">
          {submitted === "confirmed"
            ? "Recorded: it still holds. The confirmation date is staged in the entry for your next commit."
            : "Someone questioned this entry. Its reasons wait under Review."}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div>
            <Button
              ref={trigger}
              size="sm"
              variant="outline"
              aria-expanded={reviewing}
              disabled={props.busy || !props.canChallenge}
              onClick={() => {
                setReviewing((value) => !value);
                setChoice(null);
              }}
            >
              Review accuracy
            </Button>
          </div>
          {!props.canChallenge ? (
            <p className="text-xs text-muted-foreground">
              Read-only access: you cannot review entries here.
            </p>
          ) : null}
          {reviewing ? (
            <div className="flex flex-col gap-3 border-l-2 border-border pl-3">
              <div role="group" aria-label="Review outcome" className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={props.busy}
                  onClick={() => {
                    void props.onConfirm(entry).then((done) => {
                      if (done) {
                        setSubmitted("confirmed");
                        setReviewing(false);
                      }
                    });
                  }}
                >
                  {props.busy && choice === null ? "Recording…" : "It still holds"}
                </Button>
                <Button
                  size="sm"
                  variant={choice === "correction" ? "secondary" : "outline"}
                  aria-pressed={choice === "correction"}
                  disabled={props.busy}
                  onClick={() => setChoice("correction")}
                >
                  Suggest a correction
                </Button>
                <Button
                  size="sm"
                  variant={choice === "outdated" ? "secondary" : "outline"}
                  aria-pressed={choice === "outdated"}
                  disabled={props.busy}
                  onClick={() => setChoice("outdated")}
                >
                  Mark as outdated
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Every choice is recorded with your name. Confirming stamps today&apos;s date on the
                entry; a correction or an outdated mark waits under Review, where people replace or
                retire it.
              </p>
              {choice === null ? null : (
                <div className="flex flex-col gap-2">
                  <label htmlFor={reasonId} className="text-sm font-medium text-foreground">
                    {choice === "correction"
                      ? "What should it say instead?"
                      : "Why does it no longer hold?"}
                  </label>
                  <Textarea
                    id={reasonId}
                    autoFocus
                    maxLength={PEER_CHALLENGE_REASON_MAX - 20}
                    value={reason}
                    disabled={props.busy}
                    onChange={(event) => setReason(event.target.value)}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={props.busy || reason.trim() === ""}
                      onClick={() => {
                        const said =
                          choice === "correction"
                            ? `Correction: ${reason.trim()}`
                            : `Outdated: ${reason.trim()}`;
                        void props.onChallenge(entry, said).then((done) => {
                          if (done) {
                            setSubmitted(choice);
                            setReviewing(false);
                            setReason("");
                          }
                        });
                      }}
                    >
                      {props.busy ? "Submitting…" : "Send for review"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={props.busy}
                      onClick={() => {
                        setReviewing(false);
                        setChoice(null);
                        setReason("");
                        trigger.current?.focus();
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** One labelled part of an entry's detail: what it decides, why, where, how far it is checked. */
function DetailPart({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h4>
      {children}
    </div>
  );
}
