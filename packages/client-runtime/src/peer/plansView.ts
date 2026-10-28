/**
 * What the Plans section says of a task, on web and on the phone alike: the live plans of the task's
 * agents with what each changes, uses and provides, the relations from that task's side, the agents
 * that declared nothing, the challenges that meet the task's plans, and the count on the task's
 * page. Pure, so the clients only draw it. Every name, item, contract line, reason and note in it is
 * teammate text and stays a plain string: a client renders it as text, never as markup. A client draws the parts it has room for: the web app marks an agent with
 * its `initial` and links a relation to the other task (`open`); the phone's list is read-only and
 * draws neither.
 */
import type {
  PeerHubStatus,
  PeerPlan,
  PeerPlanChallenge,
  PeerPlanChallengeRole,
  PeerPlanSide,
  PeerPlansView,
} from "@t3tools/contracts";

import { personName } from "./needsYou.ts";
import {
  livePlansForTask,
  planItemLabel,
  planItemWhat,
  planKindLabel,
  planProvidesLine,
  planRelationMark,
  planRelationsForTask,
  plansBadgeText,
  plansChallengeCount,
  plansRelationCount,
  type PlanRelationKind,
  type PlanRelationRow,
} from "./plans.ts";
import { activePlugin } from "./plugins.ts";
import { agoInWords, harnessName } from "./work.ts";

/** One relation as a plan's card lists it. */
export interface PlanRelationLine {
  readonly key: string;
  readonly kind: PlanRelationKind;
  /** "Uses their change". */
  readonly kindLabel: string;
  /** What the two meet at: `applyTax (src/tax.ts)`. */
  readonly item: string;
  /** "ORD-11 · Ana’s agent plans to change it". */
  readonly who: string;
  /** The other side's contract line, teammate text, for a use of a symbol its plan provides. */
  readonly contract: string | null;
  /** "Certain", "Uncertain: …" or "Observed: …". */
  readonly mark: string;
  /** The other work's task, when the project lists it, so a client that can open a task links it. */
  readonly open: { readonly task: string; readonly label: string } | null;
}

/** A line of a plan's Changes: what it will change, or may. */
export interface PlanItemLine {
  readonly text: string;
  readonly maybe: boolean;
}

/** An agent session as a card names it: whose, on what harness, with the mark's letter. */
export interface PlanAgent {
  /** "Bob’s Claude". */
  readonly agent: string;
  /** The first letter of the person's name, for the mark a client draws beside the agent. */
  readonly initial: string;
  readonly mine: boolean;
}

export interface PlanCardModel extends PlanAgent {
  readonly kind: "plan";
  readonly key: string;
  /** "Plan v2 · declared 12 min ago". */
  readonly heading: string;
  readonly changes: ReadonlyArray<PlanItemLine>;
  readonly uses: ReadonlyArray<string>;
  readonly provides: ReadonlyArray<string>;
  readonly relations: ReadonlyArray<PlanRelationLine>;
}

/** An agent on the task whose session declared no plan: its reported changes still count. */
export interface NoPlanCardModel extends PlanAgent {
  readonly kind: "no-plan";
  readonly key: string;
  readonly line: string;
  readonly relations: ReadonlyArray<PlanRelationLine>;
}

/** A work whose live plan meets a challenged item, and what that plan does with it. */
export interface PlanChallengeMeetLine {
  readonly key: string;
  /** "ORD-11 · Ana’s agent provides it". */
  readonly who: string;
  /** The work's contract line for a provided symbol, teammate text. */
  readonly contract: string | null;
}

/**
 * An agent's challenge of an item the task's plans meet, or one an agent on the task made. Read-only:
 * people neither open nor close one. The reason and the note are teammate text, never instructions.
 */
export interface PlanChallengeLine {
  readonly key: string;
  readonly state: "open" | "closed";
  /** "Open" or "Closed". */
  readonly stateLabel: string;
  /** What is challenged: `formatPrice (src/money.ts)`. */
  readonly item: string;
  /** "Challenged by ORD-9 · Bob’s agent · 12 min ago". */
  readonly by: string;
  readonly reason: string;
  /** "Closed by ORD-11 · Ana’s agent · 2 min ago", while closed. */
  readonly closed: string | null;
  readonly note: string | null;
  /** The works whose live plans meet the item now; empty when none does. */
  readonly meets: ReadonlyArray<PlanChallengeMeetLine>;
}

export interface PlansSectionModel {
  readonly cards: ReadonlyArray<PlanCardModel | NoPlanCardModel>;
  /**
   * Relations that name the task but none of the agents the cards show: the plans and the status
   * were read a moment apart. They are listed so the count on the task's page stays true.
   */
  readonly loose: ReadonlyArray<PlanRelationLine>;
  /**
   * The challenges that meet the task, open ones first; absent when the Hub serves no challenges
   * (plans revision 1), so a client says nothing of them.
   */
  readonly challenges?: ReadonlyArray<PlanChallengeLine>;
  /** How many of `challenges` are open, the number the task's count adds. */
  readonly openChallenges?: number;
}

export const NO_PLAN_LINE =
  "has not declared a plan. Its reported changes still count for other works’ relations.";

/** Said under a challenge whose item no live plan meets now. */
export const NO_MEETS_LINE = "No live plan meets this item now.";

const ROLE_WORDS: Readonly<Record<PeerPlanChallengeRole, string>> = {
  uses: "uses it",
  changes: "plans to change it",
  maybe: "may change it",
  provides: "provides it",
};

/**
 * The challenges that meet a task: one of the works its item meets is on the task, or an agent on
 * the task made it, so the challenger's task lists it too. Open ones first, then the one touched
 * last. Undefined while the view carries no challenges (an older Hub).
 */
export function planChallengesForTask(
  view: PeerPlansView | undefined,
  place: { readonly task: string; readonly project?: string | undefined },
): ReadonlyArray<PeerPlanChallenge> | undefined {
  if (view?.challenges === undefined) return undefined;
  return view.challenges
    .filter(
      (challenge) =>
        (place.project === undefined || challenge.project === place.project) &&
        (challenge.by.task === place.task ||
          challenge.meets.some((met) => met.side.task === place.task)),
    )
    .sort(
      (a, b) =>
        Number(a.state !== "open") - Number(b.state !== "open") ||
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.id.localeCompare(b.id),
    );
}

/** One agent session in the three parts every record of it carries. */
interface Party {
  readonly session: string;
  readonly email: string;
  /** Unknown for a session an older Hub reported: it then matches on the other two parts. */
  readonly environment: string | undefined;
}

const same = (a: Party, b: Party) =>
  a.session === b.session &&
  a.email === b.email &&
  (a.environment === undefined || b.environment === undefined || a.environment === b.environment);

const initialOf = (name: string) => name.trim().charAt(0).toUpperCase() || "?";

/**
 * What the section says of a task: the live plans of its agents, newest first, each with the
 * relations from its side; then the agents on the task that declared no plan. Teammate text is
 * only ever a string here.
 */
export function plansSectionModel(input: {
  readonly status: PeerHubStatus;
  readonly workspace: string;
  readonly project: string;
  readonly task: string;
  readonly view: PeerPlansView | undefined;
  readonly now: number;
}): PlansSectionModel {
  const { status, workspace, project, task, view, now } = input;
  const tasks =
    status.workspaces
      .find((candidate) => candidate.slug === workspace)
      ?.projects.find((candidate) => candidate.project.id === project)?.work.tasks ?? [];
  const taskOf = (id: string | undefined) =>
    id === undefined ? undefined : tasks.find((candidate) => candidate.id === id);
  const person = (email: string) => personName(status, workspace, email);

  /** "ORD-11", the task's title, or the label of a thread on no task. */
  const workOf = (side: PeerPlanSide) => {
    const known = taskOf(side.task);
    return known?.key ?? known?.title ?? side.label;
  };

  const relationLine = (row: PlanRelationRow): PlanRelationLine => {
    const owner = `${person(row.other.email)}’s`;
    const agent = `${owner} ${row.other.email === row.own.email ? "other work" : "agent"}`;
    const does =
      row.kind === "uses-their-change"
        ? "plans to change it"
        : row.kind === "changes-their-use"
          ? "plans to use it"
          : "also plans to change it";
    const said = !row.observed
      ? `${agent} ${does}`
      : row.kind === "changes-their-use"
        ? `${agent} plans to use it; this session already changed it`
        : `${owner} session already changed it`;
    const known = taskOf(row.other.task);
    return {
      key: row.id,
      kind: row.kind,
      kindLabel: planKindLabel(row.kind),
      item: planItemWhat(row.item),
      who: `${workOf(row.other)} · ${said}`,
      contract:
        row.kind === "uses-their-change" && row.contract !== undefined
          ? `${planItemWhat(row.item)}: ${row.contract}`
          : null,
      mark: planRelationMark(row),
      open: known === undefined ? null : { task: known.id, label: known.key ?? known.title },
    };
  };

  const rows = planRelationsForTask(view, { task, project });
  const placed = new Set<string>();
  const relationsOf = (party: Party) =>
    rows
      .filter((row) => same(row.own, party))
      .map((row) => {
        placed.add(row.id);
        return relationLine(row);
      });

  const sessions = status.coordination.sessions.filter(
    (session) =>
      session.workspace === workspace && session.project === project && session.task === task,
  );
  const partyOfSession = (session: (typeof sessions)[number]): Party => ({
    session: session.id,
    email: session.email,
    environment: session.environment,
  });
  const agentOf = (email: string, harness: string | undefined): PlanAgent => {
    const name = person(email);
    return {
      agent: `${name}’s ${harnessName(harness) ?? "agent"}`,
      initial: initialOf(name),
      mine: email === status.email,
    };
  };

  const plans = livePlansForTask(view, { task, project });
  const planCard = (plan: PeerPlan): PlanCardModel => {
    const party: Party = {
      session: plan.session,
      email: plan.email,
      environment: plan.environment,
    };
    const session = sessions.find((candidate) => same(partyOfSession(candidate), party));
    const at = Date.parse(plan.updatedAt);
    return {
      kind: "plan",
      key: `plan:${plan.email}:${plan.environment}:${plan.session}`,
      ...agentOf(plan.email, session?.agent),
      heading: `Plan v${plan.version}${Number.isFinite(at) ? ` · declared ${agoInWords(at, now)}` : ""}`,
      changes: [
        ...plan.changes.map((item) => ({ text: planItemLabel(item), maybe: false })),
        ...plan.maybes.map((item) => ({ text: planItemLabel(item), maybe: true })),
      ],
      uses: plan.uses.map(planItemLabel),
      provides: plan.provides.map(planProvidesLine),
      relations: relationsOf(party),
    };
  };
  const planned = plans.map(planCard);

  const quiet = sessions
    .filter(
      (session) =>
        !plans.some((plan) =>
          same(
            { session: plan.session, email: plan.email, environment: plan.environment },
            partyOfSession(session),
          ),
        ),
    )
    .map((session): NoPlanCardModel => ({
      kind: "no-plan",
      key: `session:${session.email}:${session.environment ?? ""}:${session.id}`,
      ...agentOf(session.email, session.agent),
      line: NO_PLAN_LINE,
      relations: relationsOf(partyOfSession(session)),
    }))
    .sort((a, b) => Number(b.mine) - Number(a.mine) || a.agent.localeCompare(b.agent));

  const workAndPerson = (side: PeerPlanSide) => `${workOf(side)} · ${person(side.email)}’s agent`;
  const ago = (at: string) => {
    const time = Date.parse(at);
    return Number.isFinite(time) ? ` · ${agoInWords(time, now)}` : "";
  };
  const challengeLine = (challenge: PeerPlanChallenge): PlanChallengeLine => ({
    key: challenge.id,
    state: challenge.state,
    stateLabel: challenge.state === "open" ? "Open" : "Closed",
    item: planItemWhat(challenge.item),
    by: `Challenged by ${workAndPerson(challenge.by)}${ago(challenge.createdAt)}`,
    reason: challenge.reason,
    closed:
      challenge.state === "closed" && challenge.closed !== undefined
        ? `Closed by ${workAndPerson(challenge.closed.by)}${ago(challenge.closed.at)}`
        : challenge.state === "closed"
          ? "Closed"
          : null,
    note: challenge.state === "closed" ? (challenge.closed?.note ?? null) : null,
    meets: challenge.meets.map((met) => ({
      key: `${met.side.email}:${met.side.environment}:${met.side.session}:${met.role}`,
      who: `${workAndPerson(met.side)} ${ROLE_WORDS[met.role]}`,
      contract: met.contract ?? null,
    })),
  });
  const challenged = planChallengesForTask(view, { task, project });
  const challenges = challenged?.map(challengeLine);

  return {
    cards: [...planned, ...quiet],
    loose: rows.filter((row) => !placed.has(row.id)).map(relationLine),
    ...(challenges === undefined
      ? {}
      : {
          challenges,
          openChallenges: challenges.filter((line) => line.state === "open").length,
        }),
  };
}

/** Nothing for people to read: no plan, no agent without one, no relation, no challenge. */
export const plansSectionEmpty = (model: PlansSectionModel) =>
  model.cards.length === 0 && model.loose.length === 0 && (model.challenges?.length ?? 0) === 0;

/**
 * The count on a task's page and row, which opens its context page: the relations that name the task
 * and its open challenges in one badge, nothing while neither does.
 */
export function plansBadge(
  status: Pick<PeerHubStatus, "plans" | "plugins">,
  place: {
    readonly workspace: string;
    readonly project: string | undefined;
    readonly task: string;
  },
): string | null {
  if (place.project === undefined || !activePlugin(status, "plans")) return null;
  const at = { workspace: place.workspace, project: place.project, task: place.task };
  return plansBadgeText(
    plansRelationCount(status.plans, at),
    plansChallengeCount(status.plans, at),
  );
}
