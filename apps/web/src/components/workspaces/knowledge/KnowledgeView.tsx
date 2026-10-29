import { servesChallenges } from "@t3tools/client-runtime/peer/knowledge";
import {
  PEER_KEPT_TEXT_MAX,
  type EnvironmentId,
  type PeerKeptCandidate,
  type PeerKnowledgeCandidate,
  type PeerKnowledgeRelation,
  type PeerHubDecideCandidateInput,
  type PeerKnowledgeStatus,
  type PeerProjectState,
} from "@t3tools/contracts";
import { ChevronRightIcon, CircleCheckIcon, SparklesIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { useCopyToClipboard } from "../../../hooks/useCopyToClipboard";
import { cn } from "../../../lib/utils";
import { usePrimaryEnvironment } from "../../../state/environments";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Checkbox } from "../../ui/checkbox";
import { SidebarInset } from "../../ui/sidebar";
import { Textarea } from "../../ui/textarea";
import { stackedThreadToast, toastManager } from "../../ui/toast";
import { PeerCallout } from "../PeerDialog";
import { PeerPageHeader } from "../PeerPageHeader";
import { ChallengedSection } from "./Challenged";
import { KeepOperations, type KeepChoice, type KeepOutcome } from "./KeepOperations";
import {
  candidateGroups,
  decisionStats,
  findingOperations,
  knowledgeTopics,
  kontextCaptureCommand,
  meaningfulRelations,
  operationSummary,
  relationOffer,
  type TopicSuggestion,
} from "./knowledge.logic";
import { knowledgeBody } from "./knowledgeError.logic";
import { KnowledgeProblem } from "./KnowledgeProblem";
import { reportFailure } from "../workFeedback";
import { hubFailure, usePeerHubStatus } from "../WorkspaceAccess";
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
  // Findings waiting to be kept open the page on Review; otherwise it opens on what is known.
  const [tab, setTab] = useState<Tab>(waiting > 0 ? "review" : "knowledge");
  // What was kept while this page is open stays as a card that says where it went.
  const [kept, setKept] = useState<
    ReadonlyMap<
      string,
      { readonly candidate: PeerKnowledgeCandidate; readonly kept: PeerKeptCandidate }
    >
  >(new Map());
  const candidates = list.data ?? [];
  const groups = candidateGroups(candidates);
  const proposed = groups.current;
  const [relationsOf, setRelationsOf] = useState<
    ReadonlyMap<string, ReadonlyArray<PeerKnowledgeRelation>>
  >(new Map());
  const asksRelations = environmentId !== null && knowledge?.store === true;
  const waitingTopics = knowledgeTopics(
    proposed.filter((candidate) => !kept.has(candidate.id)),
    relationsOf,
  );
  const decisions = waitingTopics.filter((topic) => topic.suggestion === "conflicts").length;
  // Where kontext can add to an entry, each finding offers the operation its relation selects.
  const extendsOn = asksRelations && knowledge?.extends === true;
  const byOperation = extendsOn
    ? operationSummary(
        waitingTopics.flatMap((topic) =>
          topic.candidates.map(
            (candidate) => findingOperations(relationsOf.get(candidate.id) ?? []).primary,
          ),
        ),
      )
    : null;
  const taskName = (task: string | undefined) => {
    if (task === undefined) return "work outside tasks";
    const found = state?.work.tasks.find((t) => t.id === task);
    return found === undefined ? task : taskLabel(found);
  };
  const settled = candidates.filter((c) => c.status !== "proposed" && !kept.has(c.id));
  const stats = decisionStats(candidates);
  // "Nothing waits" is only ever what the Hub answered: a list that is on its way, failed or was
  // never asked for has its note or card instead.
  const body = knowledgeBody({
    asked: environmentId !== null,
    loaded: list.data !== null,
    failed: list.error !== null,
    cards: proposed.length + kept.size,
  });

  const decide = async (candidate: PeerKnowledgeCandidate, next: Status, reason?: string) => {
    if (environmentId === null) return;
    const result = await decideCandidate({
      environmentId,
      input: {
        workspace,
        project,
        id: candidate.id,
        status: next,
        ...(reason === undefined ? {} : { reason }),
      },
    });
    if (!reportFailure("Could not record that", result)) return;
    list.refresh();
  };

  /**
   * Into the project's knowledge through kontext when it keeps knowledge here, else by hand; in
   * the person's words when they edited the text, added into an entry, linked or replacing as the
   * person chose. Says whether it was kept, or refused because the entry moved since compared.
   */
  const keep = async (
    candidate: PeerKnowledgeCandidate,
    text?: string,
    how: Omit<KeepChoice, "text"> = {},
  ): Promise<KeepOutcome> => {
    if (environmentId === null) return "failed";
    const { supersedes, into } = how;
    const edited = text !== undefined && text.trim() !== "" && text.trim() !== candidate.text;
    if (knowledge?.store !== true) {
      await decide(candidate, "promoted");
      copyToClipboard(
        kontextCaptureCommand(edited ? { ...candidate, text: text.trim() } : candidate),
        undefined,
      );
      return "kept";
    }
    setBusy(candidate.id);
    const result = await keepCandidate({
      environmentId,
      input: {
        workspace,
        project,
        id: candidate.id,
        ...(edited ? { text: text.trim() } : {}),
        ...(supersedes === undefined || supersedes.length === 0 ? {} : { supersedes }),
        ...(into === undefined ? {} : { into }),
        ...(how.extends === undefined || how.extends.length === 0 ? {} : { extends: how.extends }),
      },
    });
    setBusy(null);
    // A stale entry is said on the card, which asks its relation again.
    if (hubFailure(result)?.code === "stale_entry") return "stale";
    if (!reportFailure("Could not keep it", result) || result._tag !== "Success") return "failed";
    const kept = result.value;
    setKept((current) => new Map(current).set(candidate.id, { candidate, kept }));
    setChanges((n) => n + 1);
    list.refresh();
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title: "Staged for your next commit",
        description: `${kept.way === "amended" ? `Added to ${kept.keptAs.title}: ` : ""}${kept.keptAs.path} in ${kept.checkout}. Agents get it at their next start.${kept.asWritten === null ? "" : ` It reads as the agents wrote it: ${kept.asWritten}.`}${kept.related === null ? "" : ` The knowledge already has “${kept.related}”: check they do not say the same.`}${kept.note === undefined ? "" : ` ${kept.note}`}`,
      }),
    );
    return "kept";
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
  const reviewSection = (
    <section aria-label="Knowledge to keep" className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-foreground">Knowledge to keep</h2>
      {stats.decided === 0 ? null : (
        <p className="text-xs text-muted-foreground">
          Kept {stats.kept} of {stats.decided} decided
          {stats.marked === 0
            ? ""
            : ` · agents' own marks kept ${stats.markedKept} of ${stats.marked}`}
          .
        </p>
      )}
      <KnowledgeProblem
        workspace={workspace}
        status={status}
        list={list}
        showingOlder={body === "cards"}
      />
      {waitingTopics.length === 0 ? null : (
        <p className="text-sm text-muted-foreground">
          {waitingTopics.length} {waitingTopics.length === 1 ? "topic" : "topics"} from{" "}
          {proposed.length} {proposed.length === 1 ? "finding" : "findings"}
          {byOperation === null
            ? decisions === 0
              ? ", none contradicts what the project already knows."
              : `, ${decisions} ${decisions === 1 ? "needs" : "need"} your decision.`
            : `: ${byOperation}.`}
        </p>
      )}
      {asksRelations && knowledge?.extends !== true ? (
        <p className="text-xs text-muted-foreground">
          This project's kontext cannot add a finding to an existing entry: each one you keep
          becomes a new entry.
        </p>
      ) : null}
      {asksRelations
        ? proposed.map((candidate) => (
            <RelationsProbe
              key={candidate.id}
              environmentId={environmentId}
              workspace={workspace}
              project={project}
              id={candidate.id}
              onRelations={(relations) =>
                setRelationsOf((current) =>
                  current.get(candidate.id) === relations
                    ? current
                    : new Map(current).set(candidate.id, relations),
                )
              }
            />
          ))
        : null}
      {body === "loading" ? (
        <p className="text-sm text-muted-foreground">Loading what agents found…</p>
      ) : body === "empty" ? (
        <p className="text-sm text-muted-foreground">Nothing waits to be kept.</p>
      ) : body === "cards" ? (
        <ul className="flex flex-col gap-3">
          {[...kept.values()].map(({ candidate, kept: entry }) => (
            <KeptCard key={candidate.id} candidate={candidate} kept={entry} state={state} />
          ))}
          {waitingTopics.map((topic) => (
            <TopicCard
              key={topic.key}
              topic={topic}
              busy={topic.candidates.some((candidate) => busy === candidate.id)}
              reviewFirst={extendsOn}
              onKeepAll={async () => {
                for (const candidate of topic.candidates) {
                  if ((await keep(candidate)) !== "kept") return;
                }
              }}
              onDismissAll={(reason) => {
                for (const candidate of topic.candidates)
                  void decide(candidate, "dismissed", reason);
              }}
            >
              {topic.candidates.map((candidate) => (
                <CandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  state={state}
                  busy={busy === candidate.id}
                  related={asksRelations ? { environmentId, workspace, project } : null}
                  operations={extendsOn}
                  taskName={taskName}
                  onKeep={(text, supersedes) =>
                    keep(candidate, text, { supersedes }).then((outcome) => outcome === "kept")
                  }
                  onKeepAs={(choice) => keep(candidate, choice.text, choice)}
                  onDismiss={(reason) => void decide(candidate, "dismissed", reason)}
                />
              ))}
            </TopicCard>
          ))}
        </ul>
      ) : null}
      {groups.older.length === 0 ? null : (
        <Older count={groups.older.length}>
          {groups.older.map((candidate) => (
            <CandidateCard
              key={candidate.id}
              candidate={candidate}
              state={state}
              busy={busy === candidate.id}
              related={null}
              operations={false}
              taskName={taskName}
              onKeep={(text) => keep(candidate, text).then((outcome) => outcome === "kept")}
              onKeepAs={(choice) => keep(candidate, choice.text, choice)}
              onDismiss={(reason) => void decide(candidate, "dismissed", reason)}
            />
          ))}
        </Older>
      )}
      {settled.length === 0 ? null : (
        <Settled
          candidates={settled}
          state={state}
          onPropose={(candidate) => void decide(candidate, "proposed")}
        />
      )}
    </section>
  );
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <PeerPageHeader
          project={{ name: projectName, colorKey: `${workspace}/${project}` }}
          page="Project knowledge"
          after={
            proposed.length === 0 ? undefined : (
              <Badge variant="knowledge" size="sm">
                {proposed.length}
              </Badge>
            )
          }
        />
        <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6">
            <div className="flex max-w-xl min-w-0 flex-col gap-1.5">
              <h1 className="text-xl font-semibold text-foreground">Project knowledge</h1>
              <p className="text-sm text-muted-foreground">
                What your agents know about {projectName}: its architecture, conventions, decisions
                and lessons, kept for longer than any one task.
              </p>
            </div>
            <div
              role="tablist"
              aria-label="Project knowledge"
              className="grid grid-cols-2 gap-1 rounded-lg border border-border p-1 sm:grid-cols-4"
            >
              {TABS.map((id) => (
                <Button
                  key={id}
                  role="tab"
                  id={`knowledge-tab-${id}`}
                  aria-selected={tab === id}
                  aria-controls="knowledge-panel"
                  size="sm"
                  variant={tab === id ? "secondary" : "ghost"}
                  onClick={() => setTab(id)}
                >
                  {TAB_LABEL[id]}
                  {id === "review" && proposed.length > 0 ? (
                    <Badge variant="knowledge" size="sm">
                      {proposed.length}
                    </Badge>
                  ) : null}
                </Button>
              ))}
            </div>
            <div
              role="tabpanel"
              id="knowledge-panel"
              aria-labelledby={`knowledge-tab-${tab}`}
              className="flex min-w-0 flex-col gap-6"
            >
              {tab === "knowledge" || tab === "flows" ? (
                environmentId !== null && status !== null && servesChallenges(status) ? (
                  <ChallengedSection
                    key={`${environmentId}/${workspace}/${project}/${tab}`}
                    part={tab}
                    environmentId={environmentId}
                    workspace={workspace}
                    project={project}
                    me={status.email ?? undefined}
                    state={state}
                    waiting={changes}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {status === null
                      ? "Loading saved knowledge…"
                      : "This Hub does not serve saved knowledge yet."}
                  </p>
                )
              ) : tab === "review" ? (
                <>
                  {reviewSection}
                  {environmentId !== null && status !== null && servesChallenges(status) ? (
                    <ChallengedSection
                      key={`${environmentId}/${workspace}/${project}/review`}
                      part="review"
                      environmentId={environmentId}
                      workspace={workspace}
                      project={project}
                      me={status.email ?? undefined}
                      state={state}
                      waiting={changes}
                    />
                  ) : null}
                  <ImproveGuidance
                    knowledge={knowledge}
                    decided={stats.decided}
                    busy={busy === "guidance"}
                    canImprove={canImprove}
                    onImprove={() => void improve()}
                  />
                </>
              ) : (
                <>
                  <StoreLine
                    knowledge={knowledge}
                    busy={busy === "setup"}
                    onSetUp={() => void setUp()}
                  />
                  <Guidance knowledge={knowledge} />
                </>
              )}
            </div>
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

type Tab = "knowledge" | "flows" | "review" | "rules";
const TABS: readonly Tab[] = ["knowledge", "flows", "review", "rules"];
const TAB_LABEL: Readonly<Record<Tab, string>> = {
  knowledge: "Knowledge",
  flows: "Flows",
  review: "Review",
  rules: "Rules for agents",
};

/** The guidance the project's agents get on what to mark for it: how Peer behaves, not knowledge. */
function Guidance({ knowledge }: { readonly knowledge: PeerKnowledgeStatus | null }) {
  if (knowledge === null || !knowledge.store) return null;
  return (
    <section aria-label="Guidance for agents" className="flex flex-col gap-2">
      <h2 className="text-base font-semibold text-foreground">What agents mark for the project</h2>
      <p className="text-sm text-muted-foreground">
        The rule agents follow when they decide which findings to propose here. It shapes what
        reaches Review; it is not itself knowledge about the project.
      </p>
      <p className="rounded-lg border border-border bg-card p-3 text-sm whitespace-pre-wrap text-foreground">
        {knowledge.guidance ??
          "None of its own yet: agents follow Peer's general rule on what to mark [project]."}
      </p>
    </section>
  );
}

/**
 * Better guidance from people's decisions: kontext proposes a convention from what was kept and
 * dismissed, which people review in the commit.
 */
function ImproveGuidance({
  knowledge,
  decided,
  busy,
  canImprove,
  onImprove,
}: {
  readonly knowledge: PeerKnowledgeStatus | null;
  readonly decided: number;
  readonly busy: boolean;
  readonly canImprove: boolean;
  readonly onImprove: () => void;
}) {
  if (knowledge === null || !knowledge.store) return null;
  return (
    <section
      aria-label="Improve agents' guidance"
      className="flex flex-col gap-2 border-t border-border pt-4"
    >
      <h2 className="text-sm font-semibold text-foreground">Teach agents what to propose</h2>
      <p className="text-sm text-muted-foreground">
        {!knowledge.llm
          ? "Peer can learn from what you keep and dismiss once kontext has its llm adapter."
          : decided < 3
            ? `Keep or dismiss ${3 - decided} more ${3 - decided === 1 ? "finding" : "findings"} and Peer can suggest better rules for what agents propose, from your decisions.`
            : "Peer suggests better rules for what agents propose, from what you kept and dismissed. You review the suggestion in the commit."}
      </p>
      <div>
        <Button size="sm" variant="outline" disabled={!canImprove || busy} onClick={onImprove}>
          {busy ? "Suggesting…" : "Suggest better rules"}
        </Button>
      </div>
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
  const harvested = candidate.sources.find((source) => source.origin !== undefined)?.origin;
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
      {harvested === undefined ? null : (
        <Badge variant="secondary" size="sm">
          {harvested.startsWith("conversations:") ? "From conversations" : "From a task's context"}
        </Badge>
      )}
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
  related,
  operations,
  taskName,
  onKeep,
  onKeepAs,
  onDismiss,
}: {
  readonly candidate: PeerKnowledgeCandidate;
  readonly state: PeerProjectState | undefined;
  readonly busy: boolean;
  /** Where to ask kontext how it relates to kept entries; null when this computer cannot. */
  readonly related: {
    readonly environmentId: EnvironmentId;
    readonly workspace: string;
    readonly project: string;
  } | null;
  /** Whether it offers kontext's operations (add to, a linked new entry, replace) with a preview. */
  readonly operations: boolean;
  readonly taskName: (task: string | undefined) => string;
  /** Keeps it, in the edited words when there are, replacing the entries named; true once kept. */
  readonly onKeep: (text?: string, supersedes?: ReadonlyArray<string>) => Promise<boolean>;
  /** Keeps it the way the person chose on the card. */
  readonly onKeepAs: (choice: KeepChoice) => Promise<KeepOutcome>;
  readonly onDismiss: (reason?: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(candidate.text);
  const [replaces, setReplaces] = useState<ReadonlySet<string>>(new Set());
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
      {operations && related !== null ? (
        <KeepOperations
          {...related}
          candidate={candidate}
          busy={busy}
          taskName={taskName}
          onKeep={onKeepAs}
          onDismiss={onDismiss}
        />
      ) : null}
      {operations || related === null ? null : (
        <Relations
          {...related}
          id={candidate.id}
          replaces={replaces}
          busy={busy}
          onReplace={(entry, on) =>
            setReplaces((current) => {
              const next = new Set(current);
              if (on) next.add(entry);
              else next.delete(entry);
              return next;
            })
          }
          onDismiss={onDismiss}
        />
      )}
      {operations && related !== null ? null : (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {editing ? (
            <>
              <Button
                size="xs"
                disabled={busy || text.trim() === ""}
                onClick={() =>
                  void onKeep(text, [...replaces]).then((done) => {
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
              <Button
                size="xs"
                disabled={busy}
                onClick={() => void onKeep(undefined, [...replaces])}
              >
                {busy ? "Keeping…" : "Keep"}
              </Button>
              <Button size="xs" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button size="xs" variant="outline" disabled={busy} onClick={() => onDismiss()}>
                Dismiss
              </Button>
            </>
          )}
        </div>
      )}
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
        <span className="font-medium text-success-foreground">
          {kept.way === "amended" ? "Added to the entry · staged" : "Kept · staged"}
        </span>
        <span className="min-w-0 truncate font-mono text-foreground">{kept.keptAs.path}</span>
      </p>
      {kept.note === undefined ? null : (
        <p className="text-xs text-muted-foreground">{kept.note}</p>
      )}
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

/**
 * How kontext says a candidate relates to entries already kept: a label to check, never a verdict.
 * A possible conflict offers keeping it as the entry's replacement (unticked); the same entry
 * offers dismissing it as already kept, a reason the project's guidance learns from.
 */
function Relations({
  environmentId,
  workspace,
  project,
  id,
  replaces,
  busy,
  onReplace,
  onDismiss,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly project: string;
  readonly id: string;
  readonly replaces: ReadonlySet<string>;
  readonly busy: boolean;
  readonly onReplace: (entry: string, on: boolean) => void;
  readonly onDismiss: (reason: string) => void;
}) {
  const asked = useEnvironmentQuery(
    serverEnvironment.peerKnowledgeRelated({ environmentId, input: { workspace, project, id } }),
  );
  const relations = meaningfulRelations(asked.data?.relations ?? []);
  if (relations.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-xs">
      {relations.map((relation) => {
        const { label, offer } = relationOffer(relation.relation);
        return (
          <li key={relation.entry} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-muted-foreground">
              {label} “{relation.title}”{relation.reason === "" ? "" : ` · ${relation.reason}`}
            </span>
            {offer === "supersede" ? (
              <label className="flex cursor-pointer items-center gap-1.5 text-foreground">
                <Checkbox
                  checked={replaces.has(relation.entry)}
                  onCheckedChange={(checked) => onReplace(relation.entry, checked === true)}
                />
                Keep it as its replacement
              </label>
            ) : offer === "dismiss" ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={busy}
                onClick={() => onDismiss(`already in “${relation.title}”`)}
              >
                Dismiss: already kept
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Candidates nobody found again for 60 days, folded; a new finding brings one back. */
function Older({ count, children }: { readonly count: number; readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label="Older">
      <button
        type="button"
        aria-expanded={open}
        className="flex items-center gap-1 text-xs font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRightIcon aria-hidden className={cn("size-3", open && "rotate-90")} />
        Older · {count}
      </button>
      {open ? <ul className="flex flex-col gap-3 pt-2">{children}</ul> : null}
    </section>
  );
}

/** Asks kontext how one finding relates to kept entries, for grouping; renders nothing. */
function RelationsProbe({
  environmentId,
  workspace,
  project,
  id,
  onRelations,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly project: string;
  readonly id: string;
  readonly onRelations: (relations: ReadonlyArray<PeerKnowledgeRelation>) => void;
}) {
  const asked = useEnvironmentQuery(
    serverEnvironment.peerKnowledgeRelated({ environmentId, input: { workspace, project, id } }),
  );
  const relations = asked.data?.relations;
  useEffect(() => {
    if (relations !== undefined) onRelations(relations);
  }, [relations, onRelations]);
  return null;
}

const SUGGESTION: Record<
  TopicSuggestion,
  { readonly badge: string; readonly advice: string; readonly tone: "warning" | "secondary" }
> = {
  conflicts: {
    badge: "Decide",
    advice: "May contradict what the project knows: open it and choose which holds",
    tone: "warning",
  },
  same: {
    badge: "Already known",
    advice: "Already in the knowledge: dismiss it",
    tone: "secondary",
  },
  extends: { badge: "Extends", advice: "Adds to existing knowledge: keep it", tone: "secondary" },
  new: { badge: "New", advice: "New knowledge: keep it", tone: "secondary" },
};

/**
 * One topic of the review queue: what it is about and one suggested decision. The findings and
 * why they belong together stay folded under "Why?", each with its own decisions.
 */
function TopicCard({
  topic,
  busy,
  reviewFirst,
  onKeepAll,
  onDismissAll,
  children,
}: {
  readonly topic: ReturnType<typeof knowledgeTopics<PeerKnowledgeCandidate>>[number];
  readonly busy: boolean;
  /**
   * Keeping stages what each finding's card shows first: the topic's keep opens its findings
   * instead of keeping them unseen.
   */
  readonly reviewFirst: boolean;
  readonly onKeepAll: () => Promise<void>;
  readonly onDismissAll: (reason?: string) => void;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const count = topic.candidates.length;
  const suggestion = SUGGESTION[topic.suggestion];
  const about =
    count === 1
      ? (KIND_LABEL[topic.candidates[0]!.kind ?? "learning"] ?? topic.candidates[0]!.kind)
      : `${count} findings`;
  const keepLabel = count === 1 ? "Keep" : "Keep all";
  const dismissLabel = count === 1 ? "Dismiss" : "Dismiss all";
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
        <div className="flex min-w-0 flex-1 basis-60 flex-col gap-1">
          <h3 className="text-base font-semibold break-words text-foreground">{topic.title}</h3>
          <p className="text-sm text-muted-foreground">
            {about}
            {topic.entry === null || topic.entry === topic.title ? "" : ` · about “${topic.entry}”`}
          </p>
        </div>
        <Badge variant={suggestion.tone} size="sm">
          {suggestion.badge}
        </Badge>
      </div>
      <p className="flex items-center gap-1.5 text-sm text-foreground">
        <SparklesIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        {suggestion.advice}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          size="sm"
          variant="outline"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Hide" : topic.suggestion === "conflicts" ? "Review" : "Why?"}
        </Button>
        {topic.suggestion === "conflicts" ? null : (
          <div className="flex flex-wrap gap-2">
            {topic.suggestion === "same" ? (
              <>
                {reviewFirst ? null : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void onKeepAll()}
                  >
                    {keepLabel}
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    onDismissAll(topic.entry === null ? undefined : `already in “${topic.entry}”`)
                  }
                >
                  {dismissLabel}
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDismissAll()}>
                  {dismissLabel}
                </Button>
                {reviewFirst ? (
                  <Button size="sm" disabled={busy || open} onClick={() => setOpen(true)}>
                    {count === 1 ? "Review and apply" : `Review ${count} findings`}
                  </Button>
                ) : (
                  <Button size="sm" disabled={busy} onClick={() => void onKeepAll()}>
                    {busy ? "Keeping…" : keepLabel}
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>
      {open ? (
        <div className="flex flex-col gap-3 border-t border-border/60 pt-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {topic.reasons.length === 0
              ? count === 1
                ? "Nothing kept says this yet."
                : "These findings change the same part of the code. Nothing kept says this yet."
              : topic.reasons.join(" · ")}
          </p>
          <ul className="flex flex-col gap-3">{children}</ul>
        </div>
      ) : null}
    </li>
  );
}
