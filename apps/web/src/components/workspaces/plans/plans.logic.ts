/**
 * What Plans says on the web: a task's live plans with what each changes, uses and provides, the
 * relations from that task's side, the agents that declared nothing, a task's count, and the state
 * line in Settings. Pure, so the components only draw it. Every name, item and contract line in it
 * is teammate text and stays a plain string: the components render it as text, never as markup.
 */
import { personName } from "@t3tools/client-runtime/peer/needs-you";
import { activePlugin } from "@t3tools/client-runtime/peer/plugins";
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
} from "@t3tools/client-runtime/peer/plans";
import { agoInWords } from "@t3tools/client-runtime/peer/work";
import type {
  PeerHubStatus,
  PeerPlan,
  PeerPlanSide,
  PeerPlansStatus,
  PeerPlansView,
  PeerPluginState,
} from "@t3tools/contracts";

import { harnessName } from "../task/taskChats.logic";

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
  /** The other work's task, when the project lists it, so its page can be opened. */
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

/** What the plugin does, as Settings says it under the title. */
export const PLANS_SUMMARY =
  "Before editing, agents say what they will change, use and provide; Peer says whose work meets theirs.";

const INACTIVE_LINE =
  "While it is inactive, this computer’s agents are not asked for plans, and task pages show no Plans section.";

const liveLine = (plans: PeerPlansStatus) => {
  const live = plans.counts.reduce((n, row) => n + row.plans, 0);
  const tasks = plans.counts.filter((row) => row.plans > 0).length;
  return live === 0
    ? "No live plans on tasks."
    : `${live} live ${live === 1 ? "plan" : "plans"} on ${tasks} ${tasks === 1 ? "task" : "tasks"}.`;
};

function hubLine(plans: PeerPlansStatus, now: number): string {
  switch (plans.hubSupport) {
    case "supported": {
      const at = plans.lastContact === undefined ? Number.NaN : Date.parse(plans.lastContact);
      return Number.isFinite(at)
        ? `The Hub serves plans; last contact ${agoInWords(at, now)}.`
        : "The Hub serves plans.";
    }
    case "unsupported":
      return "The Hub did not serve plans when Peer last asked.";
    case "unknown":
      return "The Hub has not been asked yet.";
  }
}

/**
 * The state line of Settings' Plans row: what Plans holds now and what the Hub says while it is
 * active, what being inactive means while it is not. Why it is inactive is the plugin list's to
 * say (its chip and note), so it is not said twice. Null while the environment lists no Plans.
 */
export function plansSettingsState(
  plugin: PeerPluginState | undefined,
  plans: PeerPlansStatus | undefined,
  now: number,
): string | null {
  if (plugin === undefined) return null;
  if (!plugin.active) return INACTIVE_LINE;
  return plans === undefined ? null : `${liveLine(plans)} ${hubLine(plans, now)}`;
}
