import {
  WS_METHODS,
  type PeerAcceptanceVia,
  type PeerHandoffDelivery,
  type PeerHandoffDeliveryState,
  type PeerHandoffPackage,
  type PeerReviewSignal,
  type PeerTestReport,
  type PeerHandoffOutcome,
  type PeerHandoffStatus,
  type PeerHandoffPlace,
  type PeerHandoffSignals,
  type PeerHubStatus,
  type PeerTask,
  type PeerWorkContext,
  type PeerWorkThread,
} from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";
import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";
import type { DependentsGroup } from "./readiness.ts";
import { governingSummaries, itemFailed } from "./testReports.ts";
export function createPeerHandoffAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  return {
    peerHandoffRead: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "peer:handoff:read",
      tag: WS_METHODS.peerHandoffRead,
      staleTimeMs: Infinity,
    }),
    peerHandoffHandOff: createEnvironmentRpcCommand(runtime, {
      label: "peer:handoff:handOff",
      tag: WS_METHODS.peerHandoffHandOff,
    }),
    peerHandoffWithdraw: createEnvironmentRpcCommand(runtime, {
      label: "peer:handoff:withdraw",
      tag: WS_METHODS.peerHandoffWithdraw,
    }),
    peerHandoffSetTarget: createEnvironmentRpcCommand(runtime, {
      label: "peer:handoff:setTarget",
      tag: WS_METHODS.peerHandoffSetTarget,
    }),
  };
}
export function canHandOff(
  task: Pick<PeerTask, "id" | "status">,
  threads: ReadonlyArray<Pick<PeerWorkThread, "task" | "email">>,
  me: string | null,
) {
  return task.status === "done" || !me || !threads.some((t) => t.task === task.id && t.email === me)
    ? null
    : task.status === "review"
      ? "Update handoff"
      : "Hand off for review";
}
/**
 * The task context changed after a handoff was built: the version the handoff was built from, the
 * one there is now and the context's scope, which Compare and Open task context go to. Screens say
 * it their own way (the web banner, the phone's `contextMovedLine`).
 */
export interface ContextMovedOn {
  readonly read: number;
  /** Null once the context no longer exists. */
  readonly latest: number | null;
  /** `task:<id>`. */
  readonly context: string;
}
/**
 * The version of the task's shared context as this computer knows it: null when there is none now,
 * undefined when it cannot tell. Shared contexts reach a computer through agent coordination, so
 * with that off every context looks absent, and saying one "no longer exists" would be a guess.
 */
export const currentContextVersion = (
  coordination: Pick<PeerHubStatus["coordination"], "enabled" | "contexts">,
  place: PeerHandoffPlace,
): number | null | undefined =>
  coordination.enabled
    ? (coordination.contexts.find(
        (c) =>
          c.workspace === place.workspace &&
          c.project === place.projectId &&
          c.scope === `task:${place.taskId}`,
      )?.version ?? null)
    : undefined;
/** `current` is what `currentContextVersion` says; nothing moved on that this computer cannot see. */
export const contextMovedOn = (
  p: PeerHandoffPackage,
  current: number | null | undefined,
): ContextMovedOn | null =>
  !p.context || current === undefined || p.context.version === current
    ? null
    : { read: p.context.version, latest: current, context: `task:${p.task}` };
/** The moved-on fact as one sentence, for a screen without a banner (the phone). */
export function contextMovedLine(
  p: PeerHandoffPackage,
  current: number | null | undefined,
): string | null {
  const moved = contextMovedOn(p, current);
  if (moved === null) return null;
  const lead = `The task context changed after this handoff: it was built from v${moved.read}`;
  return moved.latest === null
    ? `${lead} and no longer exists.`
    : `${lead}, the latest is v${moved.latest}.`;
}
/**
 * Who wrote the latest version, as the banner says it after "the latest is v4,": "written by Ana’s
 * agent", "restored from v2 by you", nothing when the Hub does not say. `me` is the viewer's email.
 */
export function contextWritten(
  latest: Pick<PeerWorkContext, "updatedBy" | "updatedSession" | "restoredFrom"> | undefined,
  nameOf: (email: string) => string,
  me: string | null,
): string {
  if (latest?.updatedBy === undefined) return "";
  const mine = latest.updatedBy === me;
  return latest.updatedSession === undefined && latest.restoredFrom !== undefined
    ? `restored from v${latest.restoredFrom} by ${mine ? "you" : nameOf(latest.updatedBy)}`
    : `written by ${mine ? "your" : `${nameOf(latest.updatedBy)}’s`} agent`;
}
export const isEarlierHandoff = (task: Pick<PeerTask, "status">) => task.status !== "review";
/**
 * Said beside the publishing choice: a package already written stays where it is when the choice
 * changes, so it is Withdraw, not the new choice, that takes it away.
 */
export const TARGET_SWITCH_NOTE =
  "Switching leaves earlier copies where they are, in the description or as a comment; Withdraw removes both.";
export const outcomeText = (o: PeerHandoffOutcome) =>
  [
    o.notices.includes("Own handoff package withdrawn; task status unchanged.")
      ? "Handoff package withdrawn."
      : o.stored
        ? `Handoff #${o.number} ${o.changed ? "stored" : "already current"}.`
        : "Handoff package not stored.",
    ...o.notices,
    ...o.targets.map((t) => `${t.url}: ${t.reason}.`),
  ].map((l) => l.replaceAll(/[\n\r]/g, " "));
export const summaryOf = (s: PeerHandoffStatus | undefined, p: PeerHandoffPlace) =>
  s?.summaries.filter(
    (v) => v.workspace === p.workspace && v.project === p.projectId && v.task === p.taskId,
  ) ?? [];
/** Every author's number participates: another author's first package must invalidate the read. */
export const handoffRevision = (
  summaries: ReadonlyArray<{ author: string; number: number }>,
  local = 0,
) =>
  `${summaries
    .map((s) => `${s.author}:${s.number}`)
    .sort()
    .join("|")};${local}`;
export function packageRows(
  p: PeerHandoffPackage,
  nameOf: (email: string) => string = () => "a teammate",
) {
  return [
    p.context?.gist ?? "",
    ...(p.context?.sections.flatMap((s) => [
      s.name + (s.shortened ? " (shortened)" : ""),
      ...s.lines,
    ]) ?? []),
    ...(p.context?.projectLines ?? []),
    ...p.inputs.map(
      (i) =>
        `${i.key ?? i.scope}${i.title ? ` · ${i.title}` : ""}: read v${i.readVersion}; ${i.currentVersion === null ? "no longer exists" : `current v${i.currentVersion}${i.currentVersion !== i.readVersion ? " (changed since read)" : ""}`}`,
    ),
    ...p.overlaps.map(
      (o) =>
        `${o.state} with ${o.partner ? nameOf(o.partner) : "a teammate"}: ${o.files.join(", ")}${o.agreement ? ` · ${o.agreement}` : ""}`,
    ),
  ].filter(Boolean);
}

export function keyedLines(lines: ReadonlyArray<string>) {
  const seen = new Map<string, number>();
  return lines.map((text) => {
    const n = seen.get(text) ?? 0;
    seen.set(text, n + 1);
    return { id: `${text}:${n}`, text };
  });
}

/** How many lines the Hub keeps in a section of a handoff (`MAX_LINES` in its handoff composer). */
const HANDOFF_LINES_PER_SECTION = 8;

const LEADING_BULLET = /^[-*•](?:\s+|$)/u;

/**
 * A handoff line as a person reads it. The Hub keeps the bullet an agent wrote ("- ", "* " or
 * "• ") and the page draws its own, so one leading bullet goes; the rest is the agent's inline
 * markdown.
 */
export const handoffLineText = (line: string) => line.trim().replace(LEADING_BULLET, "").trim();

/** A section's lines to show: bullet-free, none empty, each keyed apart from its repeats. */
export function handoffLines(lines: ReadonlyArray<string>) {
  return keyedLines(lines).flatMap(({ id, text }) => {
    const shown = handoffLineText(text);
    return shown === "" ? [] : [{ id, text: shown }];
  });
}

/** What a shortened section says about the rest; `whose` names the colleague whose chat holds it. */
export const shortenedNote = (whose: string | null = null) =>
  `Peer keeps ${HANDOFF_LINES_PER_SECTION} lines per section; the rest is in ${
    whose === null ? "the chat" : `${whose}’s chat, on their computer`
  }.`;

type HandoffInput = PeerHandoffPackage["inputs"][number];

/** What an agent read, as the page names it: "KRK-310 task context", "Project context". */
export const inputLabel = (input: Pick<HandoffInput, "scope" | "key" | "title">) =>
  input.scope === "project"
    ? "Project context"
    : `${input.key ?? input.title ?? input.scope} task context`;

/** Whether what an agent read is still the latest, changed since (and can be compared) or gone. */
export const inputState = (input: Pick<HandoffInput, "readVersion" | "currentVersion">) =>
  input.currentVersion === null
    ? "gone"
    : input.currentVersion === input.readVersion
      ? "current"
      : "changed";

/**
 * A review policy's signals in words, for the settings section and the review page: what in the
 * Hub's facts raises a signal.
 */
export const REVIEW_SIGNAL_WORDS: Readonly<Record<PeerReviewSignal, string>> = {
  "no-report": "The task has no test report",
  failed: "The newest test report has a failed item",
  unowned: "An unverified item has neither an owner nor a task",
  "not-delivered": "The change is not shared: delivery absent, none or local",
  "open-overlap": "The session has an open overlap",
  "owner-call": "An owner's call is pending or declined",
};

/** A class of an open fact: who has to move on it, or `covered` when nobody has to. */
export type HandoffClass = "agent_action" | "coordination" | "human_decision" | "covered";

/** The classes that name a next step, as the page, the board and Needs you label them. */
export const HANDOFF_CLASS_LABEL = {
  agent_action: "Agent action needed",
  coordination: "Coordination needed",
  human_decision: "Human decision needed",
} as const;

/** The page leads with the first class that has an entry. */
export const HANDOFF_HEADLINE_ORDER = ["human_decision", "coordination", "agent_action"] as const;

export type HandoffHeadline = (typeof HANDOFF_HEADLINE_ORDER)[number];

export type HandoffActor =
  | "author_agent"
  | "dependent_task"
  | "named_person"
  | "sessions"
  | "owner";

/**
 * One structured fact of a handoff. A rule reads only these fields, never `label`: an item's text
 * cannot change its class, since Peer does not read prose.
 */
export type HandoffFact = {
  /** The item's own words, or what the page calls the fact. */
  readonly label?: string | undefined;
  /** Who is named on it: the person who answers, the owner asked, the task it is left to. */
  readonly who?: string | undefined;
} & (
  | { readonly fact: "report"; readonly exists: boolean }
  | {
      readonly fact: "delivery";
      readonly state: "absent" | "none" | "local" | "shared" | "landed";
    }
  | { readonly fact: "failed_item"; readonly home: "none" | "dependent_task" }
  | { readonly fact: "unverified_item"; readonly answered_by: "nobody" | "task" | "person" }
  | { readonly fact: "overlap"; readonly state: "open" | "resolved" }
  | {
      readonly fact: "owner_call";
      readonly state: "pending" | "accepted" | "declined" | "withdrawn" | "expired";
    }
  | { readonly fact: "changed_input"; readonly state: "changed" | "gone" }
);

interface HandoffRule {
  readonly id: string;
  readonly fact: HandoffFact["fact"];
  /** The values of the fact's one field this rule takes. */
  readonly when: ReadonlyArray<boolean | string>;
  readonly class: HandoffClass | null;
  readonly actor?: HandoffActor;
  readonly next?: string;
}

/**
 * The classification of `docs/decision-model/proposed.yaml` in the Hub repository, rule for rule and
 * under the same ids. It is exhaustive: every value of every fact meets exactly one rule. A rule with
 * no class is a fact that asks nothing.
 */
export const HANDOFF_RULES: ReadonlyArray<HandoffRule> = [
  {
    id: "no-report",
    fact: "report",
    when: [false],
    class: "agent_action",
    actor: "author_agent",
    next: "File a test report",
  },
  { id: "has-report", fact: "report", when: [true], class: null },
  {
    id: "not-observed",
    fact: "delivery",
    when: ["absent"],
    class: "agent_action",
    actor: "author_agent",
    next: "Report the delivery; an older app may not send it",
  },
  {
    id: "not-shared",
    fact: "delivery",
    when: ["none", "local"],
    class: "agent_action",
    actor: "author_agent",
    next: "Commit and push the work",
  },
  { id: "delivered", fact: "delivery", when: ["shared", "landed"], class: null },
  {
    id: "failed-no-home",
    fact: "failed_item",
    when: ["none"],
    class: "agent_action",
    actor: "author_agent",
    next: "Fix it, or leave it to a dependent task, or name the person who decides",
  },
  {
    id: "failed-left-to-dependent",
    fact: "failed_item",
    when: ["dependent_task"],
    class: "coordination",
    actor: "dependent_task",
    next: "The dependent task carries it",
  },
  {
    id: "unverified-nobody",
    fact: "unverified_item",
    when: ["nobody"],
    class: "agent_action",
    actor: "author_agent",
    next: "Run the check, or leave it to a task, or name the person who decides",
  },
  { id: "unverified-task", fact: "unverified_item", when: ["task"], class: "covered" },
  {
    id: "unverified-person",
    fact: "unverified_item",
    when: ["person"],
    class: "human_decision",
    actor: "named_person",
    next: "Answer the question",
  },
  {
    id: "overlap-open",
    fact: "overlap",
    when: ["open"],
    class: "coordination",
    actor: "sessions",
    next: "Settle it with peer resolve, then the partner's person",
  },
  { id: "overlap-resolved", fact: "overlap", when: ["resolved"], class: null },
  {
    id: "call-pending",
    fact: "owner_call",
    when: ["pending"],
    class: "human_decision",
    actor: "owner",
    next: "Decide the call",
  },
  {
    id: "call-declined",
    fact: "owner_call",
    when: ["declined"],
    class: "agent_action",
    actor: "author_agent",
    next: "Change the work or take the call back",
  },
  {
    id: "call-settled",
    fact: "owner_call",
    when: ["accepted", "withdrawn", "expired"],
    class: null,
  },
  {
    id: "input-moved",
    fact: "changed_input",
    when: ["changed", "gone"],
    class: "coordination",
    actor: "author_agent",
    next: "Read the new version with peer inputs",
  },
];

function factValue(fact: HandoffFact): boolean | string {
  switch (fact.fact) {
    case "report":
      return fact.exists;
    case "failed_item":
      return fact.home;
    case "unverified_item":
      return fact.answered_by;
    case "delivery":
    case "overlap":
    case "owner_call":
    case "changed_input":
      return fact.state;
  }
}

/** The one rule a fact meets. */
export function handoffRule(fact: HandoffFact): HandoffRule {
  const value = factValue(fact);
  const rule = HANDOFF_RULES.find(
    (candidate) => candidate.fact === fact.fact && candidate.when.includes(value),
  );
  // The rules cover every value the type allows.
  if (rule === undefined) throw new Error(`no handoff rule for ${fact.fact}: ${String(value)}`);
  return rule;
}

/** An open fact with what follows from it. `next` is null for one somebody already answers for. */
export interface HandoffStep {
  readonly rule: string;
  readonly class: HandoffClass;
  readonly actor: HandoffActor | null;
  readonly next: string | null;
  readonly label: string | null;
  readonly who: string | null;
}

export interface HandoffNextSteps {
  readonly steps: ReadonlyArray<HandoffStep>;
  /** The first class of `HANDOFF_HEADLINE_ORDER` with an entry; null when nothing asks anything. */
  readonly headline: HandoffHeadline | null;
  readonly agent_action: ReadonlyArray<HandoffStep>;
  readonly coordination: ReadonlyArray<HandoffStep>;
  readonly human_decision: ReadonlyArray<HandoffStep>;
  readonly covered: ReadonlyArray<HandoffStep>;
}

/** Who each open fact waits for, per fact and never per handoff. Nothing here is stored. */
export function handoffNextSteps(facts: ReadonlyArray<HandoffFact>): HandoffNextSteps {
  const steps = facts.flatMap((fact): ReadonlyArray<HandoffStep> => {
    const rule = handoffRule(fact);
    return rule.class === null
      ? []
      : [
          {
            rule: rule.id,
            class: rule.class,
            actor: rule.actor ?? null,
            next: rule.next ?? null,
            label: fact.label ?? null,
            who: fact.who ?? null,
          },
        ];
  });
  const of = (klass: HandoffClass) => steps.filter((step) => step.class === klass);
  return {
    steps,
    headline: HANDOFF_HEADLINE_ORDER.find((klass) => of(klass).length > 0) ?? null,
    agent_action: of("agent_action"),
    coordination: of("coordination"),
    human_decision: of("human_decision"),
    covered: of("covered"),
  };
}

const OWNER_CALL_STATES = ["pending", "accepted", "declined", "withdrawn", "expired"] as const;

const ownerCallState = (state: string) =>
  OWNER_CALL_STATES.find((candidate) => candidate === state) ?? "pending";

/** Today's facts of a handoff as the Hub reads them; none when no agent handoff was evaluated. */
export function liveHandoffFacts(live: PeerHandoffSignals): ReadonlyArray<HandoffFact> {
  if (!live.evaluated) return [];
  return [
    { fact: "report", exists: (live.reports ?? []).length > 0 },
    { fact: "delivery", state: live.handoff?.delivery?.state ?? "absent" },
    ...(live.items ?? []).map((item): HandoffFact =>
      item.failed
        ? {
            fact: "failed_item",
            home: item.task === undefined ? "none" : "dependent_task",
            label: item.text,
            who: item.task,
          }
        : {
            fact: "unverified_item",
            answered_by:
              item.owner !== undefined ? "person" : item.task !== undefined ? "task" : "nobody",
            label: item.text,
            who: item.owner ?? item.task,
          },
    ),
    ...(live.overlaps ?? []).map((overlap): HandoffFact => ({
      fact: "overlap",
      state: "open",
      label: overlap.files.join(", "),
    })),
    ...(live.ownerCalls ?? []).map((call): HandoffFact => ({
      fact: "owner_call",
      state: ownerCallState(call.state),
      label: call.paths.join(", "),
      who: call.owner,
    })),
    ...(live.changedInputs ?? []).map((input): HandoffFact => ({
      fact: "changed_input",
      state: input.currentVersion === null ? "gone" : "changed",
      label: input.scope,
    })),
  ];
}

/**
 * What a package recorded, as facts, for when current signals cannot be read. `report` is the
 * task's newest report with its items when the page read it. An owner's call is known here only as
 * its signal, which does not tell pending from declined, so it stays with a person. Only an agent's
 * evaluated handoff speaks for its report and delivery: a person's, or an older Hub's, does not.
 */
export function packageHandoffFacts(
  pkg: Pick<
    PeerHandoffPackage,
    "source" | "policy" | "report" | "delivery" | "overlaps" | "inputs"
  >,
  report?: Pick<PeerTestReport, "items"> | undefined,
): ReadonlyArray<HandoffFact> {
  const signals = pkg.policy?.signals ?? [];
  const evaluated: ReadonlyArray<HandoffFact> =
    pkg.source !== "agent" || pkg.policy === undefined
      ? []
      : [
          { fact: "report", exists: report !== undefined || pkg.report !== undefined },
          { fact: "delivery", state: pkg.delivery?.state ?? "absent" },
          ...(report !== undefined
            ? report.items.flatMap((item): ReadonlyArray<HandoffFact> => {
                if (itemFailed(item))
                  return [
                    {
                      fact: "failed_item",
                      home: item.task === undefined ? "none" : "dependent_task",
                      label: item.text,
                      who: item.task,
                    },
                  ];
                if (item.kind !== "unverified") return [];
                return [
                  {
                    fact: "unverified_item",
                    answered_by:
                      item.owner !== undefined
                        ? "person"
                        : item.task !== undefined
                          ? "task"
                          : "nobody",
                    label: item.text,
                    who: item.owner ?? item.task,
                  },
                ];
              })
            : [
                ...Array.from({ length: pkg.report?.failed ?? 0 }, (): HandoffFact => ({
                  fact: "failed_item",
                  home: "none",
                })),
                ...(pkg.report?.unowned ?? []).map((label): HandoffFact => ({
                  fact: "unverified_item",
                  answered_by: "nobody",
                  label,
                })),
              ]),
          ...(signals.includes("owner-call")
            ? [{ fact: "owner_call", state: "pending" } as const]
            : []),
        ];
  return [
    ...evaluated,
    ...pkg.overlaps
      .filter((overlap) => overlap.state === "open")
      .map((overlap): HandoffFact => ({
        fact: "overlap",
        state: "open",
        label: overlap.files.join(", "),
        who: overlap.partner ?? undefined,
      })),
    ...pkg.inputs.flatMap((input): ReadonlyArray<HandoffFact> => {
      const state = inputState(input);
      return state === "current"
        ? []
        : [{ fact: "changed_input", state, label: inputLabel(input) }];
    }),
  ];
}

type StatusFacts = Pick<PeerHubStatus, "handoff" | "testReports" | "coordination" | "ownership">;

/**
 * What the board knows of a task's handoff without a read per task: the status's summaries, whose
 * report counts move with the Hub's pings, over the signals frozen at the handoff for what no
 * summary carries. Undefined with no agent handoff, or from a Hub without a review policy. Inputs
 * that changed are not in the status, so only the task's page shows them.
 */
export function statusHandoffFacts(
  status: StatusFacts,
  place: { readonly workspace: string; readonly project: string; readonly task: string },
):
  | { readonly facts: ReadonlyArray<HandoffFact>; readonly at: string; readonly author: string }
  | undefined {
  const summary = summaryOf(status.handoff, {
    workspace: place.workspace,
    projectId: place.project,
    taskId: place.task,
  })
    .filter((candidate) => candidate.source === "agent" && candidate.policy !== undefined)
    .toSorted((a, b) => b.composedAt.localeCompare(a.composedAt))[0];
  const policy = summary?.policy;
  if (summary === undefined || policy === undefined) return undefined;
  const raised = (signal: PeerReviewSignal) => policy.signals.includes(signal);
  const reports = governingSummaries(status, place);
  const known = status.testReports !== undefined;
  const count = <T>(n: number, fact: T) => Array.from({ length: Math.max(0, n) }, () => fact);
  const failed = reports.reduce((sum, report) => sum + report.failed, 0);
  const left = reports.reduce((sum, report) => sum + (report.failedLeft ?? 0), 0);
  const unowned = reports.reduce((sum, report) => sum + report.unowned, 0);
  const asks = [...new Set(reports.flatMap((report) => report.asks ?? []))];
  const overlapOpen = status.coordination.enabled
    ? raised("open-overlap") &&
      status.coordination.overlaps.some(
        (overlap) =>
          overlap.state === "open" &&
          overlap.workspace === place.workspace &&
          overlap.project === place.project,
      )
    : raised("open-overlap");
  const calls = status.ownership?.projects
    ?.find((project) => project.workspace === place.workspace && project.project === place.project)
    ?.calls.filter((call) => call.task === place.task);
  return {
    at: summary.composedAt,
    author: summary.author,
    facts: [
      { fact: "report", exists: known ? reports.length > 0 : !raised("no-report") },
      { fact: "delivery", state: summary.delivery?.state ?? "absent" },
      // A pass Peer saw fail counts in no summary; only the frozen signal says so.
      ...count<HandoffFact>(known ? failed - left : raised("failed") ? 1 : 0, {
        fact: "failed_item",
        home: "none",
      }),
      ...count<HandoffFact>(left, { fact: "failed_item", home: "dependent_task" }),
      ...count<HandoffFact>(known ? unowned : raised("unowned") ? 1 : 0, {
        fact: "unverified_item",
        answered_by: "nobody",
      }),
      ...asks.map((who): HandoffFact => ({ fact: "unverified_item", answered_by: "person", who })),
      ...(overlapOpen ? [{ fact: "overlap", state: "open" } as const] : []),
      ...(calls === undefined
        ? raised("owner-call")
          ? [{ fact: "owner_call", state: "pending" } as const]
          : []
        : calls.map((call): HandoffFact => ({
            fact: "owner_call",
            state: ownerCallState(call.state),
            who: call.owner,
          }))),
    ],
  };
}

/** What the decision line offers: Mark done, Reopen with a note, Withdraw acceptance. */
export type DecisionAction = "done" | "reopen" | "withdraw";

/**
 * The review page's first line: who moves next. "With the agent" while only agent actions remain
 * and its run is live, a class that asks someone, the decision the policy asks of the person ("Accept
 * 1.1? 2 signals: not-delivered, unowned"), or that none is asked ("Accepted by policy v3 · waiting to
 * land", "Accepted by Ana"), with the actions that sit on it. Whether the person may take them is
 * the page's to decide (`mayAccept`).
 */
export interface DecisionLine {
  readonly kind:
    | "ask"
    | "with-agent"
    | "coordination"
    | "human-decision"
    | "accepted-by-policy"
    | "accepted"
    | "done";
  readonly text: string;
  readonly signals: ReadonlyArray<PeerReviewSignal>;
  readonly actions: ReadonlyArray<DecisionAction>;
  /** What the package recorded and is no longer so: the line does not count them. */
  readonly raisedAtHandoff: ReadonlyArray<PeerReviewSignal>;
}

/** A current acceptance as the decision line reads it: the package's, the status's or the task's. */
export interface DecisionAcceptance {
  readonly by: string;
  readonly via?: PeerAcceptanceVia | undefined;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The decision line of a package. `acceptance` is the task's current acceptance (the package's
 * own by default; pass null when it was withdrawn or given before reopening); `status` the task's
 * (review by default). `signals` are the current ones where the Hub offers them, the package's
 * otherwise; `steps` and `runLive` say who moves next.
 */
export function decisionLine(
  pkg: Pick<PeerHandoffPackage, "task" | "key" | "policy" | "acceptance">,
  acceptance: DecisionAcceptance | null | undefined = pkg.acceptance,
  options: {
    readonly status?: "open" | "review" | "done";
    readonly nameOf?: (email: string) => string;
    readonly signals?: ReadonlyArray<PeerReviewSignal> | undefined;
    readonly steps?: HandoffNextSteps | undefined;
    readonly runLive?: boolean | undefined;
  } = {},
): DecisionLine {
  const status = options.status ?? "review";
  const nameOf = options.nameOf ?? ((email: string) => email);
  const recorded = pkg.policy?.signals ?? [];
  const signals = options.signals ?? recorded;
  const raisedAtHandoff = recorded.filter((signal) => !signals.includes(signal));
  if (acceptance !== null && acceptance !== undefined) {
    if (acceptance.via === "policy") {
      const version = pkg.policy === undefined ? "" : ` v${pkg.policy.version}`;
      return {
        kind: "accepted-by-policy",
        text: `Accepted by policy${version}${status === "review" ? " · waiting to land" : ""}`,
        signals,
        actions: ["withdraw"],
        raisedAtHandoff,
      };
    }
    return {
      kind: "accepted",
      text: `Accepted by ${nameOf(acceptance.by)}`,
      signals,
      actions: ["withdraw"],
      raisedAtHandoff,
    };
  }
  if (status === "done")
    return { kind: "done", text: "Done", signals, actions: [], raisedAtHandoff };
  const line = (kind: DecisionLine["kind"], text: string): DecisionLine => ({
    kind,
    text,
    signals,
    actions: ["done", "reopen"],
    raisedAtHandoff,
  });
  const headline = options.steps?.headline ?? null;
  if (headline === "human_decision")
    return line("human-decision", HANDOFF_CLASS_LABEL.human_decision);
  if (headline === "coordination") return line("coordination", HANDOFF_CLASS_LABEL.coordination);
  if (headline === "agent_action" && options.runLive === true)
    return line("with-agent", "With the agent");
  const name = pkg.key ?? pkg.task;
  const said =
    signals.length > 0
      ? ` ${plural(signals.length, "signal", "signals")}: ${signals.join(", ")}`
      : pkg.policy === undefined
        ? ""
        : " No signals";
  return line("ask", `Accept ${name}?${said}`);
}

/** Counts of a report's items by where their claim comes from. */
export interface VerifiedCounts {
  /** Passed items Peer saw the session run. */
  readonly seen: number;
  /** Passed items only their author reports. */
  readonly authorReported: number;
  readonly failed: number;
  /** Unverified items a dependent task covers. */
  readonly leftToTasks: number;
  /** Unverified items a person answers for. */
  readonly owned: number;
  /** Unverified items with neither owner nor task. */
  readonly needsOwner: number;
}

/**
 * The Verified chip: "6 author-reported · 1 left to a task · 1 needs an owner", counted by
 * provenance from the newest report's items. `attention` when nothing was reported, an item
 * failed or one needs an owner.
 */
export function verifiedChip(report: Pick<PeerTestReport, "items"> | undefined): {
  readonly text: string;
  readonly counts: VerifiedCounts | undefined;
  readonly attention: boolean;
} {
  if (report === undefined) return { text: "No test report", counts: undefined, attention: true };
  const counts: VerifiedCounts = {
    seen: 0,
    authorReported: 0,
    failed: 0,
    leftToTasks: 0,
    owned: 0,
    needsOwner: 0,
  };
  const add = (key: keyof VerifiedCounts) => {
    (counts as { -readonly [K in keyof VerifiedCounts]: number })[key] += 1;
  };
  for (const item of report.items) {
    if (itemFailed(item)) add("failed");
    else if (item.kind === "pass") add(item.seen === undefined ? "authorReported" : "seen");
    else if (item.task !== undefined) add("leftToTasks");
    else if (item.owner !== undefined) add("owned");
    else add("needsOwner");
  }
  const parts = [
    counts.seen > 0 ? `${counts.seen} seen run by Peer` : "",
    counts.authorReported > 0 ? `${counts.authorReported} author-reported` : "",
    counts.failed > 0 ? `${counts.failed} failed` : "",
    counts.leftToTasks > 0
      ? `${counts.leftToTasks} left to ${counts.leftToTasks === 1 ? "a task" : "tasks"}`
      : "",
    counts.owned > 0 ? `${counts.owned} with an owner` : "",
    counts.needsOwner > 0
      ? `${counts.needsOwner} ${counts.needsOwner === 1 ? "needs" : "need"} an owner`
      : "",
  ].filter((part) => part !== "");
  return {
    text: parts.length === 0 ? "No items" : parts.join(" · "),
    counts,
    attention: counts.failed > 0 || counts.needsOwner > 0,
  };
}

/** How the Delivered chip names a computer: its label from the environment id the fact carries. */
export interface DeliveryNames {
  readonly computer: (environment: string) => string;
}

/** "PR #12" for a GitHub pull request url, the url otherwise. */
export const pullRequestName = (url: string) => {
  const number = /\/pull\/(\d+)(?:[/?#]|$)/u.exec(url)?.[1];
  return number === undefined ? url : `PR #${number}`;
};

const short = (id: string) => id.slice(0, 8);

/**
 * The Delivered chip: the state and where ("shared · feature/x, PR #12", "none · 2 files
 * untracked, Slavo's Mac"), and on which computer Peer saw it (`observed`, "as Peer saw it on
 * Slavo's Mac"). A package without the fact says "not observed".
 */
export function deliveredChip(
  delivery: PeerHandoffDelivery | undefined,
  names: DeliveryNames,
): {
  readonly state: PeerHandoffDeliveryState | "not-observed";
  readonly text: string;
  readonly observed: string | null;
  readonly attention: boolean;
} {
  if (delivery === undefined)
    return { state: "not-observed", text: "not observed", observed: null, attention: true };
  const computer = names.computer(delivery.environment);
  const { evidence } = delivery;
  const pulls = (evidence.pullRequests ?? []).map(pullRequestName);
  const changes = (evidence.changes ?? []).map(short);
  const where = (...parts: ReadonlyArray<string | undefined>) =>
    parts.filter((part): part is string => part !== undefined && part !== "").join(", ");
  let detail: string;
  switch (delivery.state) {
    case "none": {
      const untracked = evidence.untracked?.length ?? 0;
      const uncommitted = evidence.uncommitted?.length ?? 0;
      detail = where(
        untracked > 0 ? `${plural(untracked, "file", "files")} untracked` : undefined,
        uncommitted > 0
          ? untracked > 0
            ? `${uncommitted} uncommitted`
            : `${plural(uncommitted, "file", "files")} uncommitted`
          : undefined,
        untracked + uncommitted === 0 ? "uncommitted changes" : undefined,
        computer,
      );
      break;
    }
    case "local":
      detail = where(evidence.branch, ...changes, "not pushed", computer);
      break;
    case "shared":
      detail = where(evidence.branch, ...(evidence.bookmarks ?? []), ...changes, ...pulls);
      break;
    case "landed":
      detail = where(
        ...pulls,
        pulls.length === 0 && evidence.commit !== undefined ? short(evidence.commit) : undefined,
      );
      break;
  }
  return {
    state: delivery.state,
    text: detail === "" ? delivery.state : `${delivery.state} · ${detail}`,
    observed: `as Peer saw it on ${computer}`,
    attention: delivery.state === "none" || delivery.state === "local",
  };
}

/**
 * The Provides chip: the session's plan `provides` lines, else the brief's outcome, and who waits
 * for the task with what else each waits for (`dependentsReadiness`).
 */
export function providesChip(
  planLines: ReadonlyArray<string>,
  briefOutcome: string | null | undefined,
  readiness: ReadonlyArray<Pick<DependentsGroup, "line">>,
): {
  readonly source: "plan" | "brief" | "none";
  readonly lines: ReadonlyArray<string>;
  readonly waiting: ReadonlyArray<string>;
} {
  const plan = planLines.map((line) => line.trim()).filter((line) => line !== "");
  const outcome = briefOutcome?.trim() ?? "";
  return {
    source: plan.length > 0 ? "plan" : outcome !== "" ? "brief" : "none",
    lines: plan.length > 0 ? plan : outcome !== "" ? [outcome] : [],
    waiting: readiness.map((group) => group.line),
  };
}
