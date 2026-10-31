import {
  decisionLine,
  deliveredChip,
  HANDOFF_CLASS_LABEL,
  HANDOFF_HEADLINE_ORDER,
  handoffLines,
  handoffNextSteps,
  handoffStepRow,
  inputState,
  liveHandoffFacts,
  packageHandoffFacts,
  providesChip,
  REVIEW_SIGNAL_WORDS,
  verifiedChip,
  type DecisionAcceptance,
  type DecisionLine,
} from "@t3tools/client-runtime/peer/handoff";
import { taskAcceptance } from "@t3tools/client-runtime/peer/acceptance";
import { projectDependencyIndex } from "@t3tools/client-runtime/peer/dependencies";
import { planProvidesLine } from "@t3tools/client-runtime/peer/plans";
import {
  dependentsReadiness,
  readinessFacts,
  type DependentsGroup,
} from "@t3tools/client-runtime/peer/readiness";
import { handoffReportLine, itemFailed, itemMark } from "@t3tools/client-runtime/peer/test-reports";
import { taskBrief } from "../task/taskBrief.logic";
import {
  contextBlockerText,
  type PeerHubStatus,
  type PeerPlansView,
  type PeerProjectState,
  type PeerHandoffPackage,
  type PeerHandoffSignalsRead,
  type PeerReviewSignal,
  type PeerTestReport,
} from "@t3tools/contracts";

export function handoffPresentation(pkg: PeerHandoffPackage) {
  const sections =
    pkg.context?.sections.flatMap((section) => {
      const lines =
        section.name === "Blockers"
          ? section.lines.flatMap((line) => {
              const text = contextBlockerText(line);
              return text === undefined ? [] : [text];
            })
          : section.lines;
      return handoffLines(lines).length === 0 ? [] : [{ ...section, lines }];
    }) ?? [];
  return {
    sections,
    result: sections.find((section) => section.name === "Provides"),
    blockers: sections.find((section) => section.name === "Blockers"),
    blockersShortened:
      pkg.context?.sections.some((section) => section.name === "Blockers" && section.shortened) ??
      false,
    next: sections.find((section) => section.name === "Next"),
    openOverlaps: pkg.overlaps.filter((overlap) => overlap.state === "open"),
    changedInputs: pkg.inputs.filter((input) => inputState(input) !== "current"),
    pulls: [...new Set(pkg.pullRequests)].filter((url) =>
      /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(url),
    ),
  };
}

/** The agent's notes as the review page titles them: its blockers are its own words, not Peer's. */
export const NOTE_TITLE = {
  State: "Reported status",
  Provides: "Provides",
  Decisions: "Decisions",
  Blockers: "Blockers the agent named",
  Next: "Next",
} as const;

const NOTE_ORDER = ["Provides", "Decisions", "Blockers", "Next", "State"] as const;

/** What the review page knows besides the package; each part is absent where its plugin is off. */
export interface ReviewFacts {
  /**
   * The task's current acceptance as the status says it now (null: none, or one given before the
   * task was reopened); undefined where acceptance is off, and the package's own stands in.
   */
  readonly acceptance?: DecisionAcceptance | null | undefined;
  readonly status?: "open" | "review" | "done" | undefined;
  /** The task's newest test report with its items, when the page read it. */
  readonly report?: PeerTestReport | undefined;
  /** The `provides` contract lines of the author's plan on the task. */
  readonly planLines?: ReadonlyArray<string>;
  /** The brief's outcome, when the plan provides nothing. */
  readonly briefOutcome?: string | undefined;
  /** Who waits for the task and what else each waits for (`dependentsReadiness`). */
  readonly dependents?: ReadonlyArray<DependentsGroup>;
  /** The computer a delivery was observed on, from its environment id. */
  readonly computer: (environment: string) => string;
  readonly nameOf: (email: string) => string;
  /** A task as the page names it, for what is left to one. */
  readonly taskName?: ((id: string) => string) | undefined;
  /** The Hub's current signals, when the page read them. */
  readonly live?: PeerHandoffSignalsRead | null | undefined;
  /** The task's run can still act. */
  readonly runLive?: boolean | undefined;
}

/** One item of the evidence: the report's own words with where its claim comes from. */
export interface EvidenceItem {
  readonly key: string;
  readonly kind: PeerTestReport["items"][number]["kind"];
  readonly text: string;
  /** "seen run by Peer, passed, 14:02", "author-reported", "left to 3.1", "Ana answers for it", "needs an owner". */
  readonly mark: string;
  readonly attention: boolean;
}

function evidenceItems(
  report: PeerTestReport,
  nameOf: (email: string) => string,
  taskName: (id: string) => string,
): ReadonlyArray<EvidenceItem> {
  return report.items.map((item, index) => {
    const claim = itemMark(item);
    const mark =
      (claim === null
        ? null
        : item.task === undefined
          ? claim
          : `${claim}, left to ${taskName(item.task)}`) ??
      (item.task !== undefined
        ? `left to ${taskName(item.task)}`
        : item.owner !== undefined
          ? `${nameOf(item.owner)} answers for it`
          : "needs an owner");
    return {
      key: `${index}:${item.kind}:${item.text}`,
      kind: item.kind,
      text: item.text,
      mark,
      attention:
        itemFailed(item) ||
        (item.kind === "unverified" && item.task === undefined && item.owner === undefined),
    };
  });
}

/**
 * The review page as a decision page (D4): the decision line, the Verified, Delivered and Provides
 * chips, the evidence, the agent's notes (closed by default under a decision) and each class's open
 * facts, from Peer's own facts only, current where the Hub offers them and labelled at handoff where
 * it does not.
 */
export function reviewPresentation(
  pkg: PeerHandoffPackage,
  facts: ReviewFacts,
  taskName: (id: string) => string = facts.taskName ?? ((id) => id),
) {
  const base = handoffPresentation(pkg);
  const live = facts.live?.available === true ? facts.live.signals : undefined;
  const steps = handoffNextSteps(
    live === undefined
      ? packageHandoffFacts(pkg, facts.report)
      : live.evaluated
        ? liveHandoffFacts(live)
        : // A person moved the task since: no handoff stands, whatever the package recorded.
          packageHandoffFacts({ ...pkg, policy: undefined }),
  );
  const decision: DecisionLine = decisionLine(
    pkg,
    facts.acceptance === undefined ? pkg.acceptance : facts.acceptance,
    {
      status: facts.status ?? "review",
      nameOf: facts.nameOf,
      signals: live?.signals,
      steps,
      runLive: facts.runLive,
    },
  );
  const verified =
    facts.report !== undefined
      ? verifiedChip(facts.report)
      : pkg.report !== undefined
        ? {
            text: (handoffReportLine(pkg.report) ?? "").replace(/^Tests: /u, ""),
            counts: undefined,
            attention: pkg.report.failed > 0 || pkg.report.unowned.length > 0,
          }
        : verifiedChip(undefined);
  const wordsOf = (signal: PeerReviewSignal) => ({ signal, words: REVIEW_SIGNAL_WORDS[signal] });
  const signals = decision.signals.map(wordsOf);
  const openOverlaps =
    live === undefined || (live.overlaps ?? []).length > 0 ? base.openOverlaps : [];
  const changedInputs =
    live === undefined
      ? base.changedInputs
      : (live.changedInputs ?? []).map(
          (input) => pkg.inputs.find((candidate) => candidate.scope === input.scope) ?? input,
        );
  // The page draws overlaps and inputs with their own words and actions.
  const groupSteps = (klass: (typeof HANDOFF_HEADLINE_ORDER)[number]) =>
    steps[klass]
      .filter(
        (step) =>
          step.rule !== "input-moved" &&
          (step.rule !== "overlap-open" || openOverlaps.length === 0),
      )
      .map((step, index) => handoffStepRow(step, index, facts.nameOf, taskName));
  const accepted = decision.kind === "accepted" || decision.kind === "accepted-by-policy";
  const groups = accepted
    ? []
    : HANDOFF_HEADLINE_ORDER.flatMap((klass) =>
        steps[klass].length === 0
          ? []
          : [{ class: klass, label: HANDOFF_CLASS_LABEL[klass], steps: groupSteps(klass) }],
      );
  const notes = NOTE_ORDER.flatMap((name) => {
    const section = base.sections.find((candidate) => candidate.name === name);
    return section === undefined ? [] : [{ ...section, title: NOTE_TITLE[name] }];
  });
  const decided = decision.kind !== "done";
  return {
    ...base,
    decision: decided ? decision : null,
    groups,
    /** What someone already answers for: facts on the page, nobody's next step. */
    covered: steps.covered.map((step, index) =>
      handoffStepRow(step, index, facts.nameOf, taskName),
    ),
    /** What the package recorded and the Hub no longer says. */
    raisedAtHandoff: decision.raisedAtHandoff.map(wordsOf),
    /** The page could not read current signals, so what it shows is the package's. */
    atHandoff: live === undefined && pkg.policy !== undefined,
    /** Agent actions remain and its run has ended: it is the person's to continue. */
    agentStopped:
      !accepted &&
      (facts.status ?? "review") === "review" &&
      facts.runLive !== true &&
      steps.agent_action.length > 0,
    verified,
    delivered: deliveredChip(pkg.delivery, { computer: facts.computer }),
    provides: providesChip(facts.planLines ?? [], facts.briefOutcome, facts.dependents ?? []),
    evidence:
      facts.report === undefined ? null : evidenceItems(facts.report, facts.nameOf, taskName),
    notes,
    /** The agent's notes start closed when the page states a decision above them. */
    notesOpen: !decided,
    signals,
    openOverlaps,
    changedInputs,
  };
}

export type ReviewPresentation = ReturnType<typeof reviewPresentation>;

/**
 * What the status and the page's reads add to a package, each part only where its plugin speaks:
 * the task's acceptance as the status says it now (a withdrawn one, or one given before the task
 * was reopened, is none), the newest test report the page read, the `provides` lines of the
 * author's newest plan on the task, the brief's outcome, and who waits for the task.
 */
export function reviewFactsFrom(input: {
  readonly pkg: Pick<PeerHandoffPackage, "task" | "author">;
  readonly status: Pick<
    PeerHubStatus,
    "acceptance" | "dependencies" | "handoff" | "environmentId" | "email"
  >;
  readonly workspace: string;
  readonly state: PeerProjectState;
  readonly nameOf: (email: string) => string;
  /** The task's reports, newest first, when the page read them. */
  readonly reports?: ReadonlyArray<PeerTestReport> | undefined;
  readonly plans?: PeerPlansView | undefined;
  readonly live?: PeerHandoffSignalsRead | null | undefined;
}): ReviewFacts {
  const { pkg, status, workspace, state, nameOf } = input;
  const project = state.project.id;
  const task = state.work.tasks.find((candidate) => candidate.id === pkg.task);
  const place = { workspace, project, task: pkg.task };
  const row = status.acceptance === undefined ? undefined : taskAcceptance(status, place);
  const plan = (input.plans?.plans ?? [])
    .filter(
      (candidate) =>
        candidate.project === project &&
        candidate.task === pkg.task &&
        candidate.email.toLowerCase() === pkg.author.toLowerCase(),
    )
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const outcome = taskBrief(task?.description).outcome;
  const snapshot = status.dependencies?.find((candidate) => candidate.workspace === workspace);
  const mine = status.email !== null && status.email.toLowerCase() === pkg.author.toLowerCase();
  return {
    acceptance:
      status.acceptance === undefined
        ? undefined
        : row === undefined || row.beforeReopening === true
          ? null
          : { by: row.by, via: row.via },
    status: task?.status ?? "open",
    report: input.reports?.[0],
    planLines: plan?.provides.map(planProvidesLine) ?? [],
    briefOutcome: outcome.length === 0 ? undefined : outcome.join("; "),
    dependents:
      snapshot?.available === true
        ? dependentsReadiness(
            snapshot,
            project,
            pkg.task,
            projectDependencyIndex(state),
            readinessFacts(status, workspace, project),
          )
        : [],
    computer: (environment) =>
      environment === status.environmentId
        ? "this computer"
        : mine
          ? "your other computer"
          : `${nameOf(pkg.author)}’s computer`,
    nameOf,
    taskName: (id) => {
      const named = state.work.tasks.find((candidate) => candidate.id === id);
      return named?.key ?? named?.title ?? id;
    },
    live: input.live,
    runLive:
      (task?.runs?.running ?? 0) > 0 ||
      state.work.threads.some((thread) => thread.task === pkg.task && thread.status === "working"),
  };
}
