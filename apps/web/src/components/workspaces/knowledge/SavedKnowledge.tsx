import {
  PEER_CHALLENGE_REASON_MAX,
  type EnvironmentId,
  type PeerKnowledgeChallenges,
} from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import { useId, useRef, useState } from "react";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import ChatMarkdown from "../../ChatMarkdown";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Textarea } from "../../ui/textarea";

interface SavedKnowledgeProps {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly project: string;
  readonly entries: PeerKnowledgeChallenges["entries"];
  readonly challenged: ReadonlySet<string>;
  readonly busy: boolean;
  readonly canChallenge: boolean;
  readonly onChallenge: (entry: string, reason: string) => Promise<boolean>;
}

export function SavedKnowledge(props: SavedKnowledgeProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [visible, setVisible] = useState(10);
  const query = search.trim().toLocaleLowerCase();
  const entries = props.entries.filter((entry) =>
    `${entry.title} ${entry.kind}`.toLocaleLowerCase().includes(query),
  );
  const panelId = useId();

  return (
    <section aria-label="Saved knowledge" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">
          Saved knowledge · {props.entries.length}
        </h2>
        <p className="text-sm text-muted-foreground">
          Open an entry to read what the project keeps. If it no longer holds, challenge it there.
        </p>
      </div>
      {props.entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No saved knowledge yet.</p>
      ) : (
        <>
          <Input
            type="search"
            aria-label="Search saved knowledge"
            placeholder="Search by title or kind…"
            value={search}
            disabled={props.busy}
            onChange={(event) => {
              setSearch(event.target.value);
              setVisible(10);
            }}
          />
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved entries match this search.</p>
          ) : (
            <ul className="min-w-0 divide-y divide-border border-y border-border">
              {entries.slice(0, visible).map((entry) => {
                const expanded = selected === entry.id;
                return (
                  <li key={entry.id} className="min-w-0 py-3">
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="text-xs text-muted-foreground">{entry.kind}</span>
                      <button
                        type="button"
                        disabled={props.busy}
                        aria-expanded={expanded}
                        aria-controls={expanded ? panelId : undefined}
                        className="flex min-w-0 items-start gap-2 rounded-sm text-left text-sm font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        onClick={() => setSelected(expanded ? null : entry.id)}
                      >
                        <ChevronRightIcon
                          aria-hidden
                          className={`mt-0.5 size-4 shrink-0 ${expanded ? "rotate-90" : ""}`}
                        />
                        <span className="min-w-0 wrap-anywhere">{entry.title}</span>
                      </button>
                    </div>
                    {expanded ? (
                      <div id={panelId} className="min-w-0 pt-3">
                        <SavedEntryDetail key={entry.id} {...props} entry={entry.id} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {entries.length > visible ? (
            <div>
              <Button size="sm" variant="outline" onClick={() => setVisible((count) => count + 10)}>
                Show more entries ({entries.length - visible} remaining)
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
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
      <p className="wrap-anywhere text-xs text-muted-foreground">{saved.file}</p>
      {saved.summary === "" ? null : <p className="text-sm text-foreground">{saved.summary}</p>}
      {saved.body === "" || saved.body === saved.summary ? null : (
        <ChatMarkdown text={saved.body} cwd={undefined} />
      )}
      {submitted || props.challenged.has(entry) ? (
        <p role="status" className="text-sm text-muted-foreground">
          This entry is challenged. Review the reasons in Challenged below.
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
