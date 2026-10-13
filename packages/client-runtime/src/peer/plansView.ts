/**
 * What the Plans section says of a task, on web and on the phone alike: the live plans of the task's
 * agents with what each changes, uses and provides, the relations from that task's side, the agents
 * that declared nothing, and the count on the task's page. Pure, so the clients only draw it. Every
 * name, item and contract line in it is teammate text and stays a plain string: a client renders it
 * as text, never as markup. A client draws the parts it has room for: the web app marks an agent with
 * its `initial` and links a relation to the other task (`open`); the phone's list is read-only and
 * draws neither.
 */
import type { PeerHubStatus, PeerPlan, PeerPlanSide, PeerPlansView } from "@t3tools/contracts";

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

export interface PlansSectionModel {
  readonly cards: ReadonlyArray<PlanCardModel | NoPlanCardModel>;
  /**
   * Relations that name the task but none of the agents the cards show: the plans and the status
   * were read a moment apart. They are listed so the count on the task's page stays true.
   */
  readonly loose: ReadonlyArray<PlanRelationLine>;
}

export const NO_PLAN_LINE =
  "has not declared a plan. Its reported changes still count for other works’ relations.";

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

  return {
    cards: [...planned, ...quiet],
    loose: rows.filter((row) => !placed.has(row.id)).map(relationLine),
  };
}

/** Nothing for people to read: no plan, no agent without one, no relation. */
export const plansSectionEmpty = (model: PlansSectionModel) =>
  model.cards.length === 0 && model.loose.length === 0;

/** The count on a task's page, which opens its context page: nothing while no relation names it. */
export function plansBadge(
  status: Pick<PeerHubStatus, "plans" | "plugins">,
  place: {
    readonly workspace: string;
    readonly project: string | undefined;
    readonly task: string;
  },
): string | null {
  if (place.project === undefined || !activePlugin(status, "plans")) return null;
  return plansBadgeText(
    plansRelationCount(status.plans, {
      workspace: place.workspace,
      project: place.project,
      task: place.task,
    }),
  );
}
