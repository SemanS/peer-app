import {
  WS_METHODS,
  type EnvironmentId,
  type PeerPlan,
  type PeerPlanItem,
  type PeerPlanProvides,
  type PeerPlanRelation,
  type PeerPlanSide,
  type PeerPlansPlace,
  type PeerPlansStatus,
  type PeerPlansView,
} from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";
import type * as EnvironmentRegistry from "../connection/registry.ts";
import { createEnvironmentQueryAtomFamily } from "../state/runtime.ts";
import { request } from "../rpc/client.ts";

/**
 * Plan preflight as web and mobile read it: a task's plans and the relations that name it, told
 * from the task's side, with the words people read them in. The Hub names a relation `use` or
 * `same-change`; an agent hears a `use` as `uses-their-change` when it is the user and as
 * `changes-their-use` when it is the changer, and a task page does the same.
 */
export function createPeerPlansAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  const list = createEnvironmentQueryAtomFamily(runtime, {
    label: "peer:plans:list",
    staleTimeMs: Infinity,
    execute: (input: PeerPlansPlace) =>
      request(WS_METHODS.peerPlansList, {
        workspace: input.workspace,
        ...(input.project === undefined ? {} : { project: input.project }),
        ...(input.task === undefined ? {} : { task: input.task }),
      }),
  });
  return {
    /** The view of a place, read again when the status field's `revision` (in `input`) moves. */
    peerPlansList: (target: { environmentId: EnvironmentId; input: PeerPlansPlace }) =>
      list({ environmentId: target.environmentId, input: target.input }),
  };
}

export type PlanRelationKind = "uses-their-change" | "changes-their-use" | "same-change";

/** One relation as the work on a task reads it: its own side, the other work, and what they meet at. */
export interface PlanRelationRow {
  readonly id: string;
  readonly kind: PlanRelationKind;
  readonly project: string;
  readonly own: PeerPlanSide;
  readonly other: PeerPlanSide;
  readonly item: PeerPlanItem;
  /** No `--maybe` is involved. */
  readonly certain: boolean;
  /** The changer's item came from what its session reported, not from a plan. */
  readonly observed: boolean;
  /** The changer's contract line, for a use of a provided symbol. */
  readonly contract: string | undefined;
}

/** Where a task's plans are read: a task, in one project when two projects share its id. */
export interface PlansTaskPlace {
  readonly task: string;
  readonly project?: string | undefined;
}

const RANK: Readonly<Record<PlanRelationKind, number>> = {
  "uses-their-change": 0,
  "changes-their-use": 1,
  "same-change": 2,
};

const rowOf = (relation: PeerPlanRelation, task: string): PlanRelationRow | null => {
  const asA = relation.a.task === task;
  if (!asA && relation.b.task !== task) return null;
  return {
    id: relation.id,
    kind:
      relation.kind === "same-change"
        ? "same-change"
        : asA
          ? "uses-their-change"
          : "changes-their-use",
    project: relation.project,
    own: asA ? relation.a : relation.b,
    other: asA ? relation.b : relation.a,
    item: relation.item,
    certain: relation.certain,
    observed: relation.observed,
    contract: relation.contract,
  };
};

/**
 * The relations that name a task, told from its side: what its agents use of other work first, then
 * what other work uses of theirs, then what both change; within a kind the certain ones, declared
 * ones before observed ones, then by item. The Hub forms no relation between two sessions of one task.
 */
export function planRelationsForTask(
  view: PeerPlansView | undefined,
  place: PlansTaskPlace,
): ReadonlyArray<PlanRelationRow> {
  const key = (row: PlanRelationRow) =>
    `${row.item.path}\u0000${row.item.name ?? ""}\u0000${row.id}`;
  return (view?.relations ?? [])
    .filter((relation) => place.project === undefined || relation.project === place.project)
    .flatMap((relation) => rowOf(relation, place.task) ?? [])
    .sort(
      (a, b) =>
        RANK[a.kind] - RANK[b.kind] ||
        Number(!a.certain) - Number(!b.certain) ||
        Number(a.observed) - Number(b.observed) ||
        key(a).localeCompare(key(b)),
    );
}

/** The live plans of a task's sessions, the one changed last first. */
export const livePlansForTask = (
  view: PeerPlansView | undefined,
  place: PlansTaskPlace,
): ReadonlyArray<PeerPlan> =>
  (view?.plans ?? [])
    .filter(
      (plan) =>
        plan.live &&
        plan.task === place.task &&
        (place.project === undefined || plan.project === place.project),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

/** An item as an agent writes it: `src/tax.ts#applyTax`, a file, or a directory. */
export const planItemLabel = (item: PeerPlanItem) =>
  item.name === undefined ? item.path : `${item.path}#${item.name}`;

/** What a relation meets at, as people read it: `applyTax (src/tax.ts)`, or the path alone. */
export const planItemWhat = (item: PeerPlanItem) =>
  item.name === undefined ? item.path : `${item.name} (${item.path})`;

/** A contract line as a plan declares it: `Fee.refundCents (src/payments/fees.ts): integer cents`. */
export const planProvidesLine = (provides: PeerPlanProvides) =>
  `${provides.name} (${provides.path}): ${provides.contract}`;

export const planKindLabel = (kind: PlanRelationKind): string =>
  ({
    "uses-their-change": "Uses their change",
    "changes-their-use": "Changes their use",
    "same-change": "Same change",
  })[kind];

/**
 * What a relation rests on: reported by the session and not declared in a plan, named as maybe, or
 * certain. A relation of which a plan says maybe is uncertain; one a session's reported files
 * make is observed.
 */
export function planRelationMark(row: Pick<PlanRelationRow, "certain" | "observed" | "item">) {
  if (row.observed) return "Observed: reported by the session, not declared in a plan";
  if (!row.certain) {
    const what = row.item.path.endsWith("/") ? "directory" : row.item.name ? "symbol" : "file";
    return `Uncertain: a plan names the ${what} as maybe`;
  }
  return "Certain";
}

const inPlace = (
  row: { readonly workspace: string; readonly project: string; readonly task: string },
  place: { readonly workspace: string; readonly project?: string; readonly task?: string },
) =>
  row.workspace === place.workspace &&
  (!place.project || row.project === place.project) &&
  (!place.task || row.task === place.task);

/** The relations that name a place's tasks, from the status field alone: a count for a row or badge. */
export const plansRelationCount = (
  status: PeerPlansStatus | undefined,
  place: { workspace: string; project?: string; task?: string },
) =>
  status?.counts.filter((row) => inPlace(row, place)).reduce((n, row) => n + row.relations, 0) ?? 0;

/** The live plans on a place's tasks, from the status field alone. */
export const plansPlanCount = (
  status: PeerPlansStatus | undefined,
  place: { workspace: string; project?: string; task?: string },
) => status?.counts.filter((row) => inPlace(row, place)).reduce((n, row) => n + row.plans, 0) ?? 0;

/** The count on a task's page: `Plans · 1 relation`; nothing while no relation names the task. */
export const plansBadgeText = (relations: number): string | null =>
  relations > 0 ? `Plans · ${relations} ${relations === 1 ? "relation" : "relations"}` : null;
