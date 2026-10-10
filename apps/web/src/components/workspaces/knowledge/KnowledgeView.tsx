import {
  PEER_KEPT_TEXT_MAX,
  type PeerKeptCandidate,
  type PeerKnowledgeCandidate,
  type PeerHubDecideCandidateInput,
  type PeerKnowledgeStatus,
  type PeerProjectState,
} from "@t3tools/contracts";
import { ChevronRightIcon, CircleCheckIcon } from "lucide-react";
import { useState } from "react";

import { useCopyToClipboard } from "../../../hooks/useCopyToClipboard";
import { cn } from "../../../lib/utils";
import { usePrimaryEnvironment } from "../../../state/environments";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { SidebarInset } from "../../ui/sidebar";
import { Textarea } from "../../ui/textarea";
import { stackedThreadToast, toastManager } from "../../ui/toast";
import { PeerCallout } from "../PeerDialog";
import { PeerPageHeader } from "../PeerPageHeader";
import { decisionStats, kontextCaptureCommand } from "./knowledge.logic";
import { reportFailure } from "../workFeedback";
import { usePeerHubStatus } from "../WorkspaceAccess";
import { personName, taskLabel } from "../workTree.logic";

type Status = PeerHubDecideCandidateInput["status"];

/**
 * What agents found that a project may want to keep beyond their tasks: lines
 * an agent marked for the project, findings several agents reached on their
 * own, and what a task's context held. People keep a candidate, which kontext
 * writes into the project's knowledge (staged, reviewed with the commit), or
 * dismiss it. Their decisions are what the agents' guidance is improved on.
 */
export function KnowledgeView({
  workspace,
  project,
}: {
  readonly workspace: string;
  readonly project: string;
}) {
  const primary = usePrimaryEnvironment();
  const environmentId =
    primary !== null && primary.connection.phase === "connected" ? primary.environmentId : null;
  const status = usePeerHubStatus(environmentId);
  const state = status?.workspaces
    .find((w) => w.slug === workspace)
    ?.projects.find((p) => p.project.id === project);
  const waiting =
    status?.coordination.candidates.find((c) => c.workspace === workspace && c.project === project)
      ?.proposed ?? 0;
  const [changes, setChanges] = useState(0);
  const list = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.peerHubKnowledgeCandidates({
          environmentId,
          input: { workspace, project, waiting },
        }),
  );
  const store = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.peerHubKnowledgeStatus({
          environmentId,
          input: { workspace, project, waiting: changes },
        }),
  );
  const knowledge = store.data ?? null;
  const decideCandidate = useAtomCommand(serverEnvironment.peerHubDecideCandidate, {
    reportFailure: false,
  });
  const keepCandidate = useAtomCommand(serverEnvironment.peerHubKeepCandidate, {
    reportFailure: false,
  });
  const setupKnowledge = useAtomCommand(serverEnvironment.peerHubSetupKnowledge, {
    reportFailure: false,
  });
  const improveGuidance = useAtomCommand(serverEnvironment.peerHubImproveGuidance, {
    reportFailure: false,
  });
  const { copyToClipboard } = useCopyToClipboard<void>({
    onCopy: () =>
      toastManager.add(
        stackedThreadToast({
          type: "success",
          title: "Marked to keep",
          description:
            "The kontext command is on your clipboard: run it in the project's repository, then promote and commit it there.",
        }),
      ),
  });
  const [busy, setBusy] = useState<string | null>(null);
  // What was kept while this page is open stays as a card that says where it went.
  const [kept, setKept] = useState<
    ReadonlyMap<
      string,
      { readonly candidate: PeerKnowledgeCandidate; readonly kept: PeerKeptCandidate }
    >
  >(new Map());
  const candidates = list.data ?? [];
  const proposed = candidates.filter((c) => c.status === "proposed");
  const settled = candidates.filter((c) => c.status !== "proposed" && !kept.has(c.id));
  const stats = decisionStats(candidates);

  const decide = async (candidate: PeerKnowledgeCandidate, next: Status) => {
    if (environmentId === null) return;
    const result = await decideCandidate({
      environmentId,
      input: { workspace, project, id: candidate.id, status: next },
    });
    if (!reportFailure("Could not record that", result)) return;
    list.refresh();
  };

  /**
   * Into the project's knowledge through kontext when it keeps knowledge here, else by hand; in
   * the person's words when they edited the text. Returns whether it was kept.
   */
  const keep = async (candidate: PeerKnowledgeCandidate, text?: string): Promise<boolean> => {
    if (environmentId === null) return false;
    const edited = text !== undefined && text.trim() !== "" && text.trim() !== candidate.text;
    if (knowledge?.store !== true) {
      await decide(candidate, "promoted");
      copyToClipboard(
        kontextCaptureCommand(edited ? { ...candidate, text: text.trim() } : candidate),
        undefined,
      );
      return true;
    }
    setBusy(candidate.id);
    const result = await keepCandidate({
      environmentId,
      input: { workspace, project, id: candidate.id, ...(edited ? { text: text.trim() } : {}) },
    });
    setBusy(null);
    if (!reportFailure("Could not keep it", result) || result._tag !== "Success") return false;
    const kept = result.value;
    setKept((current) => new Map(current).set(candidate.id, { candidate, kept }));
    list.refresh();
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title: "Staged for your next commit",
        description: `${kept.keptAs.path} in ${kept.checkout}. Agents get it at their next start.${kept.asWritten === null ? "" : ` It reads as the agents wrote it: ${kept.asWritten}.`}${kept.related === null ? "" : ` The knowledge already has “${kept.related}”: check they do not say the same.`}`,
      }),
    );
    return true;
  };

  const setUp = async () => {
    if (environmentId === null) return;
    setBusy("setup");
    const result = await setupKnowledge({ environmentId, input: { workspace, project } });
    setBusy(null);
    if (reportFailure("Could not set up knowledge", result)) setChanges((n) => n + 1);
  };

  const improve = async () => {
    if (environmentId === null) return;
    setBusy("guidance");
    const result = await improveGuidance({ environmentId, input: { workspace, project } });
    setBusy(null);
    if (!reportFailure("Could not propose guidance", result) || result._tag !== "Success") return;
    setChanges((n) => n + 1);
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title: `Proposed guidance: ${result.value.title}`,
        description: `Staged as ${result.value.path} in ${result.value.checkout}. Read it, then commit it: from then on the project's agents follow it.`,
      }),
    );
  };

  const projectName = state?.project.name ?? project;
  const canImprove = knowledge?.store === true && knowledge.llm && stats.decided >= 3;
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <PeerPageHeader
          project={{ name: projectName, colorKey: `${workspace}/${project}` }}
          page="Knowledge to keep"
          after={
            proposed.length === 0 ? undefined : (
              <Badge variant="knowledge" size="sm">
                {proposed.length}
              </Badge>
            )
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
              <div className="flex max-w-xl min-w-0 flex-col gap-1.5">
                <h1 className="text-xl font-semibold text-foreground">Knowledge to keep</h1>
                <p className="text-sm text-muted-foreground">
                  What agents found that {projectName} may want to keep. Keep writes it to .ai
                  through kontext, staged for your next commit.
                </p>
              </div>
              {knowledge?.store === true ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canImprove || busy === "guidance"}
                  onClick={() => void improve()}
                >
                  {busy === "guidance" ? "Proposing…" : "Improve from decisions"}
                </Button>
              ) : null}
            </div>
            <StoreLine knowledge={knowledge} busy={busy === "setup"} onSetUp={() => void setUp()} />
            {stats.decided === 0 ? null : (
              <p className="text-xs text-muted-foreground">
                Kept {stats.kept} of {stats.decided} decided
                {stats.marked === 0
                  ? ""
                  : ` · agents' own marks kept ${stats.markedKept} of ${stats.marked}`}
                .
              </p>
            )}
            {list.data == null && list.error !== null ? (
              <p className="text-sm text-muted-foreground">{list.error}</p>
            ) : proposed.length + kept.size === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing waits to be kept.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {[...kept.values()].map(({ candidate, kept: entry }) => (
                  <KeptCard key={candidate.id} candidate={candidate} kept={entry} state={state} />
                ))}
                {proposed
                  .filter((candidate) => !kept.has(candidate.id))
                  .map((candidate) => (
                    <CandidateCard
                      key={candidate.id}
                      candidate={candidate}
                      state={state}
                      busy={busy === candidate.id}
                      onKeep={(text) => keep(candidate, text)}
                      onDismiss={() => void decide(candidate, "dismissed")}
                    />
                  ))}
              </ul>
            )}
            {settled.length === 0 ? null : (
              <Settled
                candidates={settled}
                state={state}
                onPropose={(candidate) => void decide(candidate, "proposed")}
              />
            )}
            <Guidance knowledge={knowledge} decided={stats.decided} />
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

/** Where the project's knowledge lives here, or how to start keeping it. */
function StoreLine({
  knowledge,
  busy,
  onSetUp,
}: {
  readonly knowledge: PeerKnowledgeStatus | null;
  readonly busy: boolean;
  readonly onSetUp: () => void;
}) {
  if (knowledge === null) return null;
  if (knowledge.store && knowledge.checkout !== null) {
    return (
      <p className="text-xs text-muted-foreground">
        Kept candidates go into <span className="font-mono">{knowledge.checkout}/.ai</span>, staged
        for your next commit there.
      </p>
    );
  }
  if (knowledge.checkout === null) {
    return (
      <PeerCallout tone="neutral">
        The project is not on this computer: Keep copies a kontext command instead.
      </PeerCallout>
    );
  }
  if (!knowledge.kontext) {
    return (
      <PeerCallout tone="neutral">
        Install kontext to keep knowledge in this project; until then Keep copies its command.
      </PeerCallout>
    );
  }
  return (
    <PeerCallout tone="knowledge">
      <span className="flex flex-wrap items-center gap-2">
        <span>This project keeps no knowledge yet ({knowledge.checkout}).</span>
        <Button size="xs" variant="outline" disabled={busy} onClick={onSetUp}>
          {busy ? "Setting up…" : "Set up knowledge"}
        </Button>
      </span>
    </PeerCallout>
  );
}

/**
 * The guidance the project's agents get on what to mark for it, and the way
 * to improve it from people's decisions: kontext proposes a convention from
 * what was kept and dismissed, which people review in the commit.
 */
function Guidance({
  knowledge,
  decided,
}: {
  readonly knowledge: PeerKnowledgeStatus | null;
  readonly decided: number;
}) {
  const [open, setOpen] = useState(false);
  if (knowledge === null || !knowledge.store) return null;
  return (
    <section
      aria-label="Guidance for agents"
      className="flex flex-col gap-2 border-t border-border pt-4"
    >
      <button
        type="button"
        aria-expanded={open}
        className="flex items-center gap-1 text-2xs font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRightIcon aria-hidden className={cn("size-3", open && "rotate-90")} />
        Guidance for agents
      </button>
      {open ? (
        <div className="flex flex-col gap-2 text-sm">
          <p className="whitespace-pre-wrap text-foreground">
            {knowledge.guidance ??
              "None of its own yet: agents follow Peer's general rule on what to mark [project]."}
          </p>
          <p className="text-xs text-muted-foreground">
            {!knowledge.llm
              ? "Improve from decisions needs kontext's llm adapter."
              : decided < 3
                ? `Improve from decisions works once you keep or dismiss ${3 - decided} more.`
                : "Improve from decisions has kontext propose it from what people kept and dismissed; you review it in the commit."}
          </p>
        </div>
      ) : null}
    </section>
  );
}

/** Who found it and where, as people name them. */
function sourcesLine(candidate: PeerKnowledgeCandidate, state: PeerProjectState | undefined) {
  const where = (task: string | undefined) => {
    if (task === undefined) return "outside tasks";
    const found = state?.work.tasks.find((t) => t.id === task);
    return found === undefined ? task : taskLabel(found);
  };
  return [
    ...new Set(
      candidate.sources.map(
        (source) =>
          `${state === undefined ? source.email : personName(state, source.email)}’s agent (${where(source.task)})`,
      ),
    ),
  ].join(", ");
}

const KIND_LABEL: Readonly<Record<string, string>> = {
  decision: "Decision",
  convention: "Convention",
  learning: "Learning",
  incident: "Incident",
};

/** What a candidate is: its kind as a violet chip, how many agents reached it, where it came from. */
function CandidateChips({ candidate }: { readonly candidate: PeerKnowledgeCandidate }) {
  const marked = candidate.sources.some((source) => source.tagged && source.origin === undefined);
  const harvested = candidate.sources.some((source) => source.origin !== undefined);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge variant="knowledge" size="sm">
        {KIND_LABEL[candidate.kind ?? "learning"] ?? candidate.kind}
      </Badge>
      {candidate.finders > 1 ? (
        <Badge variant="outline" size="sm">
          {candidate.finders} agents reached it on their own
        </Badge>
      ) : null}
      {marked ? (
        <Badge variant="secondary" size="sm">
          Marked for the project
        </Badge>
      ) : null}
      {harvested ? (
        <Badge variant="secondary" size="sm">
          From a task&apos;s context
        </Badge>
      ) : null}
      {candidate.reopened === true ? (
        <Badge variant="warning" size="sm">
          Found again after a dismissal
        </Badge>
      ) : null}
    </span>
  );
}

function CandidateCard({
  candidate,
  state,
  busy,
  onKeep,
  onDismiss,
}: {
  readonly candidate: PeerKnowledgeCandidate;
  readonly state: PeerProjectState | undefined;
  readonly busy: boolean;
  /** Keeps it, in the edited words when there are; true once it is kept. */
  readonly onKeep: (text?: string) => Promise<boolean>;
  readonly onDismiss: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(candidate.text);
  return (
    <li className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
        <CandidateChips candidate={candidate} />
        <span className="min-w-0 text-xs text-muted-foreground">
          {sourcesLine(candidate, state)} · {formatRelativeTimeLabel(candidate.lastAt)}
        </span>
      </div>
      {editing ? (
        <Textarea
          aria-label="What to keep"
          autoFocus
          value={text}
          maxLength={PEER_KEPT_TEXT_MAX}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
        />
      ) : (
        <p className="text-sm font-semibold text-foreground">{candidate.text}</p>
      )}
      {candidate.detail === undefined ? null : (
        <p className="text-sm whitespace-pre-wrap text-muted-foreground">{candidate.detail}</p>
      )}
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {editing ? (
          <>
            <Button
              size="xs"
              disabled={busy || text.trim() === ""}
              onClick={() =>
                void onKeep(text).then((done) => {
                  if (done) setEditing(false);
                })
              }
            >
              {busy ? "Keeping…" : "Keep"}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setText(candidate.text);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="xs" disabled={busy} onClick={() => void onKeep()}>
              {busy ? "Keeping…" : "Keep"}
            </Button>
            <Button size="xs" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button size="xs" variant="outline" disabled={busy} onClick={onDismiss}>
              Dismiss
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/** A candidate kept while the page is open: where it was staged. */
function KeptCard({
  candidate,
  kept,
  state,
}: {
  readonly candidate: PeerKnowledgeCandidate;
  readonly kept: PeerKeptCandidate;
  readonly state: PeerProjectState | undefined;
}) {
  return (
    <li className="flex flex-col gap-2.5 rounded-xl border border-success/40 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
        <CandidateChips candidate={candidate} />
        <span className="min-w-0 text-xs text-muted-foreground">
          {sourcesLine(candidate, state)}
        </span>
      </div>
      <p className="text-sm font-semibold text-foreground">{kept.keptAs.title}</p>
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <CircleCheckIcon aria-hidden className="size-3.5 shrink-0 text-success-foreground" />
        <span className="font-medium text-success-foreground">Kept · staged</span>
        <span className="min-w-0 truncate font-mono text-foreground">{kept.keptAs.path}</span>
      </p>
      {kept.related === null ? null : (
        <p className="text-xs text-warning-foreground">
          The knowledge already has “{kept.related}”: check they do not say the same before you
          commit.
        </p>
      )}
    </li>
  );
}

/** Candidates people kept or dismissed, folded; each can be proposed again. */
function Settled({
  candidates,
  state,
  onPropose,
}: {
  readonly candidates: ReadonlyArray<PeerKnowledgeCandidate>;
  readonly state: PeerProjectState | undefined;
  readonly onPropose: (candidate: PeerKnowledgeCandidate) => void;
}) {
  const [open, setOpen] = useState(false);
  const who = (email: string | undefined) =>
    email === undefined ? "someone" : state === undefined ? email : personName(state, email);
  return (
    <section aria-label="Decided">
      <button
        type="button"
        aria-expanded={open}
        className="flex items-center gap-1 text-xs font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRightIcon aria-hidden className={cn("size-3", open && "rotate-90")} />
        Decided · {candidates.length}
      </button>
      {open ? (
        <ul className="flex flex-col gap-2 pt-2">
          {candidates.map((candidate) => (
            <li key={candidate.id} className="flex min-w-0 items-start gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-foreground">{candidate.text}</span>
                <span className="block text-xs text-muted-foreground">
                  {candidate.status === "kept_pending_review"
                    ? "Kept · waiting for Git review"
                    : candidate.status === "promoted"
                      ? candidate.keptAs === undefined
                        ? "Kept"
                        : `Kept as ${candidate.keptAs.path}`
                      : "Dismissed"}{" "}
                  by {who(candidate.decidedBy)}
                  {candidate.decidedAt === undefined
                    ? ""
                    : `, ${formatRelativeTimeLabel(candidate.decidedAt)}`}
                </span>
              </span>
              <Button size="xs" variant="ghost" onClick={() => onPropose(candidate)}>
                Propose again
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
