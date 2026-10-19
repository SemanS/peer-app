import {
  PEER_CHALLENGE_REASON_MAX,
  type PeerChallengeDraft,
  type PeerChallengeRow,
  type PeerHubDecideChallengeInput,
  type PeerKnowledgeChallenges,
  type PeerProjectState,
} from "@t3tools/contracts";
import {
  challengeActive,
  challengeOffers,
  challengeWho,
  type ChallengeActionId,
} from "@t3tools/client-runtime/peer/knowledge";
import type { EnvironmentId } from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../../lib/utils";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { Textarea } from "../../ui/textarea";
import { stackedThreadToast, toastManager } from "../../ui/toast";
import { reportFailure } from "../workFeedback";
import { personName, taskLabel } from "../workTree.logic";
import { decidedChallenges } from "./knowledge.logic";

const ACTION_LABEL: Readonly<Record<ChallengeActionId, string>> = {
  second: "Second",
  dismiss: "Dismiss",
  reopen: "Open again",
  replace: "Write a replacement",
  retire: "Retire",
  resolve: "Resolve",
};

/**
 * Entries of the project's knowledge that agents or people said may no longer hold: who said so
 * and why, and what to do. Dismissing says it still holds; a replacement or a retirement is staged
 * for the next commit, and the challenge is resolved once that commit shows the entry retired.
 */
export function ChallengedSection({
  environmentId,
  workspace,
  project,
  me,
  state,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly project: string;
  readonly me: string | undefined;
  readonly state: PeerProjectState | undefined;
}) {
  const [changes, setChanges] = useState(0);
  const list = useEnvironmentQuery(
    serverEnvironment.peerKnowledgeChallenges({
      environmentId,
      input: { workspace, project, waiting: changes },
    }),
  );
  const decide = useAtomCommand(serverEnvironment.peerKnowledgeDecideChallenge, {
    reportFailure: false,
  });
  const open = useAtomCommand(serverEnvironment.peerKnowledgeOpenChallenge, {
    reportFailure: false,
  });
  const draftReplacement = useAtomCommand(serverEnvironment.peerKnowledgeDraftReplacement, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const data = list.data;
  if (data === null) return null;
  const active = data.rows.filter((row) => challengeActive(row.challenge));
  const decided = decidedChallenges(data.rows);

  const after = () => {
    setChanges((n) => n + 1);
    list.refresh();
  };
  const run = async (
    row: PeerChallengeRow,
    decision: PeerHubDecideChallengeInput["decision"],
    more: { readonly seenRevision?: string; readonly draft?: PeerChallengeDraft } = {},
  ) => {
    setBusy(row.challenge.id);
    const result = await decide({
      environmentId,
      input: { workspace, project, id: row.challenge.id, decision, ...more },
    });
    setBusy(null);
    if (!reportFailure("Could not record that", result) || result._tag !== "Success") return false;
    const staged = result.value.staged;
    if (staged !== null)
      toastManager.add(
        stackedThreadToast({
          type: "success",
          title: "Staged for your next commit",
          description: `${staged.path} in ${staged.checkout}. The challenge is resolved once that commit shows it.`,
        }),
      );
    after();
    return true;
  };
  const second = async (row: PeerChallengeRow, reason: string) => {
    setBusy(row.challenge.id);
    const result = await open({
      environmentId,
      input: { workspace, project, entry: row.challenge.entry, reason },
    });
    setBusy(null);
    if (reportFailure("Could not second it", result)) after();
  };
  const draft = async (row: PeerChallengeRow, seenRevision: string | undefined) => {
    setBusy(row.challenge.id);
    const result = await draftReplacement({
      environmentId,
      input: {
        workspace,
        project,
        id: row.challenge.id,
        ...(seenRevision === undefined ? {} : { seenRevision }),
      },
    });
    setBusy(null);
    return reportFailure("Could not draft a replacement", result) && result._tag === "Success"
      ? result.value.draft
      : null;
  };

  return (
    <section aria-label="Challenged" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Challenged{active.length === 0 ? "" : ` · ${active.length}`}
        </h2>
        <ChallengeEntry
          data={data}
          busy={busy === "new"}
          onChallenge={async (entry, reason) => {
            setBusy("new");
            const result = await open({
              environmentId,
              input: { workspace, project, entry, reason },
            });
            setBusy(null);
            const done = reportFailure("Could not challenge it", result);
            if (done) after();
            return done;
          }}
        />
      </div>
      {active.length === 0 ? null : (
        <ul className="flex flex-col gap-3">
          {active.map((row) => (
            <ChallengeCard
              key={row.challenge.id}
              row={row}
              data={data}
              me={me}
              state={state}
              busy={busy === row.challenge.id}
              onDecide={(decision, more) => run(row, decision, more)}
              onSecond={(reason) => void second(row, reason)}
              onDraft={(seen) => draft(row, seen)}
            />
          ))}
        </ul>
      )}
      {decided.length === 0 ? null : (
        <DecidedChallenges
          rows={decided}
          data={data}
          me={me}
          state={state}
          onReopen={(row) => void run(row, "open")}
        />
      )}
    </section>
  );
}

/** Who said it and on what work, as people name them. */
function sourceLine(
  source: PeerChallengeRow["challenge"]["sources"][number],
  state: PeerProjectState | undefined,
) {
  const who = state === undefined ? source.email : personName(state, source.email);
  if (source.session === "person") return who;
  const task =
    source.task === undefined ? undefined : state?.work.tasks.find((t) => t.id === source.task);
  return `${who}’s agent (${task === undefined ? (source.task ?? "outside tasks") : taskLabel(task)})`;
}

function ChallengeCard({
  row,
  data,
  me,
  state,
  busy,
  onDecide,
  onSecond,
  onDraft,
}: {
  readonly row: PeerChallengeRow;
  readonly data: PeerKnowledgeChallenges;
  readonly me: string | undefined;
  readonly state: PeerProjectState | undefined;
  readonly busy: boolean;
  readonly onDecide: (
    decision: PeerHubDecideChallengeInput["decision"],
    more?: { readonly seenRevision?: string; readonly draft?: PeerChallengeDraft },
  ) => Promise<boolean>;
  readonly onSecond: (reason: string) => void;
  readonly onDraft: (seenRevision: string | undefined) => Promise<PeerChallengeDraft | null>;
}) {
  const { challenge, current, changed } = row;
  const [reread, setReread] = useState(false);
  const [seconding, setSeconding] = useState<string | null>(null);
  const [draft, setDraft] = useState<PeerChallengeDraft | null>(null);
  const seen = changed && reread ? current?.revision : undefined;
  const offers = challengeOffers(row, data, { surface: "web", me });
  const blocked = changed && !reread;
  const act = (id: ChallengeActionId) => {
    if (id === "second") setSeconding("");
    else if (id === "dismiss") void onDecide("dismissed");
    else if (id === "reopen") void onDecide("open");
    else if (id === "resolve") void onDecide("resolved");
    else if (id === "retire")
      void onDecide("retire", seen === undefined ? {} : { seenRevision: seen });
    else void onDraft(seen).then((made) => setDraft(made));
  };
  return (
    <li className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge variant="warning" size="sm">
            {challenge.status === "resolving" ? "Replacement staged" : "Challenged"}
          </Badge>
          <Badge variant="outline" size="sm">
            {challengeWho(challenge)}
          </Badge>
          {challenge.reopened === true ? (
            <Badge variant="secondary" size="sm">
              Said again after a dismissal
            </Badge>
          ) : null}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatRelativeTimeLabel(challenge.lastAt)}
        </span>
      </div>
      <p className="text-sm font-semibold text-foreground">
        {current?.title ?? challenge.entry}
        {current === null ? (
          <span className="font-normal text-muted-foreground"> · entry not in this checkout</span>
        ) : (
          <span className="font-mono text-xs font-normal text-muted-foreground">
            {" "}
            · {current.file}
          </span>
        )}
      </p>
      <ul className="flex flex-col gap-1">
        {challenge.sources.slice(0, 5).map((source) => (
          <li key={source.finding} className="text-sm text-foreground">
            “{source.text}”
            <span className="text-xs text-muted-foreground"> — {sourceLine(source, state)}</span>
          </li>
        ))}
      </ul>
      {challenge.status === "resolving" && challenge.resolvedAs !== undefined ? (
        <p className="text-xs text-muted-foreground">
          Staged as <span className="font-mono">{challenge.resolvedAs.path}</span>
          {challenge.decidedBy === undefined
            ? ""
            : ` by ${state === undefined ? challenge.decidedBy : personName(state, challenge.decidedBy)}`}
          : resolved once a commit shows it. If it was dropped, open it again or dismiss it.
        </p>
      ) : null}
      {changed && current !== null ? (
        <div className="flex flex-col gap-1.5 text-xs">
          <p className="text-warning-foreground">
            The entry changed since it was challenged: read it as it is now before you act on it.
          </p>
          {reread ? (
            <p className="whitespace-pre-wrap text-foreground">
              {current.summary === "" ? current.body : current.summary}
            </p>
          ) : (
            <Button size="xs" variant="outline" onClick={() => setReread(true)}>
              Read it as it is now
            </Button>
          )}
        </div>
      ) : null}
      {draft === null ? null : (
        <ReplacementEditor
          draft={draft}
          busy={busy}
          onCancel={() => setDraft(null)}
          onStage={(edited) =>
            void onDecide("replace", {
              draft: edited,
              ...(seen === undefined ? {} : { seenRevision: seen }),
            }).then((done) => {
              if (done) setDraft(null);
            })
          }
        />
      )}
      {seconding === null ? null : (
        <div className="flex flex-col gap-1.5">
          <Input
            aria-label="Why it may no longer hold"
            autoFocus
            placeholder="Why it may no longer hold"
            maxLength={PEER_CHALLENGE_REASON_MAX}
            value={seconding}
            onChange={(event) => setSeconding(event.target.value)}
          />
          <div className="flex gap-1.5">
            <Button
              size="xs"
              disabled={busy || seconding.trim() === ""}
              onClick={() => {
                onSecond(seconding.trim());
                setSeconding(null);
              }}
            >
              Second
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setSeconding(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {draft !== null || seconding !== null ? null : (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {offers.map((offer, index) => {
            const needsRead = blocked && (offer.id === "replace" || offer.id === "retire");
            return (
              <Button
                key={offer.id}
                size="xs"
                variant={index === 0 ? "default" : "outline"}
                disabled={busy || offer.unavailable !== null || needsRead}
                title={
                  offer.unavailable ??
                  (needsRead ? "Read the entry as it is now first." : undefined)
                }
                onClick={() => act(offer.id)}
              >
                {ACTION_LABEL[offer.id]}
              </Button>
            );
          })}
        </div>
      )}
      {offers.some((offer) => offer.unavailable !== null && offer.id === "replace") ? (
        <p className="text-xs text-muted-foreground">
          {offers.find((offer) => offer.id === "replace")?.unavailable}
        </p>
      ) : null}
    </li>
  );
}

/** kontext's draft of a replacement, for the person to edit before it is staged. */
function ReplacementEditor({
  draft,
  busy,
  onCancel,
  onStage,
}: {
  readonly draft: PeerChallengeDraft;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onStage: (draft: PeerChallengeDraft) => void;
}) {
  const [title, setTitle] = useState(draft.title);
  const [body, setBody] = useState(draft.body);
  return (
    <div className="flex flex-col gap-1.5">
      <Input aria-label="Title" value={title} onChange={(event) => setTitle(event.target.value)} />
      <Textarea
        aria-label="The replacement"
        value={body}
        rows={6}
        onChange={(event) => setBody(event.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        Staged with the old entry marked superseded; the commit and its review approve it.
      </p>
      <div className="flex gap-1.5">
        <Button
          size="xs"
          disabled={busy || title.trim() === "" || body.trim() === ""}
          onClick={() => onStage({ ...draft, title: title.trim(), body: body.trim() })}
        >
          {busy ? "Staging…" : "Stage the replacement"}
        </Button>
        <Button size="xs" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Opens a challenge of an entry the project keeps, with why. */
function ChallengeEntry({
  data,
  busy,
  onChallenge,
}: {
  readonly data: PeerKnowledgeChallenges;
  readonly busy: boolean;
  readonly onChallenge: (entry: string, reason: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [entry, setEntry] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  if (data.entries.length === 0) return null;
  if (!open)
    return (
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        Challenge an entry
      </Button>
    );
  return (
    <div className="flex w-full flex-col gap-1.5 rounded-xl border border-border bg-card p-3">
      <Select
        value={entry}
        onValueChange={(next) => setEntry(typeof next === "string" ? next : null)}
      >
        <SelectTrigger size="xs" aria-label="Entry">
          <SelectValue placeholder="Which entry no longer holds?" />
        </SelectTrigger>
        <SelectPopup>
          {data.entries.map((one) => (
            <SelectItem key={one.id} value={one.id}>
              {one.title}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <Input
        aria-label="Why it may no longer hold"
        placeholder="Why it may no longer hold"
        maxLength={PEER_CHALLENGE_REASON_MAX}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <div className="flex gap-1.5">
        <Button
          size="xs"
          disabled={busy || entry === null || reason.trim() === ""}
          onClick={() =>
            entry !== null &&
            void onChallenge(entry, reason.trim()).then((done) => {
              if (!done) return;
              setOpen(false);
              setEntry(null);
              setReason("");
            })
          }
        >
          {busy ? "Challenging…" : "Challenge"}
        </Button>
        <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Dismissed and resolved challenges, folded; a dismissed one can be opened again. */
function DecidedChallenges({
  rows,
  data,
  me,
  state,
  onReopen,
}: {
  readonly rows: ReadonlyArray<PeerChallengeRow>;
  readonly data: PeerKnowledgeChallenges;
  readonly me: string | undefined;
  readonly state: PeerProjectState | undefined;
  readonly onReopen: (row: PeerChallengeRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const who = (email: string | undefined) =>
    email === undefined ? "someone" : state === undefined ? email : personName(state, email);
  return (
    <section aria-label="Decided challenges">
      <button
        type="button"
        aria-expanded={open}
        className="flex items-center gap-1 text-xs font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRightIcon aria-hidden className={cn("size-3", open && "rotate-90")} />
        Decided challenges · {rows.length}
      </button>
      {open ? (
        <ul className="flex flex-col gap-2 pt-2">
          {rows.map((row) => (
            <li key={row.challenge.id} className="flex min-w-0 items-start gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-foreground">
                  {row.current?.title ?? row.challenge.entry}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {row.challenge.status === "resolved"
                    ? row.challenge.resolvedAs === undefined
                      ? "Resolved"
                      : `Resolved by ${row.challenge.resolvedAs.path}`
                    : "Dismissed: it still holds"}{" "}
                  · {who(row.challenge.decidedBy)}
                  {row.challenge.decidedAt === undefined
                    ? ""
                    : `, ${formatRelativeTimeLabel(row.challenge.decidedAt)}`}
                </span>
              </span>
              {challengeOffers(row, data, { surface: "web", me }).some(
                (offer) => offer.id === "reopen",
              ) ? (
                <Button size="xs" variant="ghost" onClick={() => onReopen(row)}>
                  Open again
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
