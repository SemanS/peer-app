import * as Schema from "effect/Schema";

/**
 * Plan preflight on the wire: what an agent declares before it writes (what it will change, may
 * change and use, and the contracts it provides), the relations the Hub finds between works'
 * plans, and what a client reads of them. Shapes follow the Hub's `plans` feature (camelCase JSON
 * below `/v1/workspaces/{slug}`); a field a newer Hub adds is dropped on decoding.
 */
const count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

/**
 * What a plan names: a repository path (a directory ends in `/`) and, for a file, one of its
 * symbols. A path without a name stands for every symbol in it.
 */
export const PeerPlanItem = Schema.Struct({
  path: Schema.String,
  name: Schema.optional(Schema.String),
});
export type PeerPlanItem = typeof PeerPlanItem.Type;

/** A contract a plan provides: a symbol (which counts as a change of it) and the line saying what it will be. */
export const PeerPlanProvides = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  contract: Schema.String,
});
export type PeerPlanProvides = typeof PeerPlanProvides.Type;

/** How a declaration meets the session's current plan: it replaces it, or adds to it. */
export const PeerPlanMode = Schema.Literals(["replace", "amend"]);
export type PeerPlanMode = typeof PeerPlanMode.Type;

/** The body of `PUT …/plans/{project}`; a plan needs at least one item. */
export const PeerPlanDeclaration = Schema.Struct({
  environment: Schema.String,
  session: Schema.String,
  /** The declaration's time in milliseconds: the Hub refuses one older than the stored plan's. */
  seq: count,
  mode: Schema.optional(PeerPlanMode),
  changes: Schema.optional(Schema.Array(PeerPlanItem)),
  maybes: Schema.optional(Schema.Array(PeerPlanItem)),
  uses: Schema.optional(Schema.Array(PeerPlanItem)),
  provides: Schema.optional(Schema.Array(PeerPlanProvides)),
});
export type PeerPlanDeclaration = typeof PeerPlanDeclaration.Type;

/** One session's plan in one project, with whether its session is at work now. */
export const PeerPlan = Schema.Struct({
  project: Schema.String,
  session: Schema.String,
  email: Schema.String,
  environment: Schema.String,
  task: Schema.optional(Schema.String),
  label: Schema.String,
  seq: count,
  /** 1 for the first plan; it moves only when the items do. */
  version: count,
  changes: Schema.Array(PeerPlanItem),
  /** Items the plan may change: relations they form are marked uncertain. */
  maybes: Schema.Array(PeerPlanItem),
  uses: Schema.Array(PeerPlanItem),
  provides: Schema.Array(PeerPlanProvides),
  declaredAt: Schema.String,
  updatedAt: Schema.String,
  live: Schema.Boolean,
});
export type PeerPlan = typeof PeerPlan.Type;

/** Who a relation is about: one agent session and the work it is on. */
export const PeerPlanSide = Schema.Struct({
  session: Schema.String,
  email: Schema.String,
  environment: Schema.String,
  label: Schema.String,
  task: Schema.optional(Schema.String),
});
export type PeerPlanSide = typeof PeerPlanSide.Type;

/**
 * How the Hub names a relation: both works change the same thing (`same-change`, `a` and `b` in
 * session order), or `a` uses what `b` changes (`use`). A client tells it from one side:
 * `uses-their-change` to `a`, `changes-their-use` to `b` (`peer/plans` in the client runtime).
 */
export const PeerPlanRelationKind = Schema.Literals(["same-change", "use"]);
export type PeerPlanRelationKind = typeof PeerPlanRelationKind.Type;

/** A fact about two works' plans, computed by the Hub and never stored: its `id` is the same across versions of a plan. */
export const PeerPlanRelation = Schema.Struct({
  id: Schema.String,
  kind: PeerPlanRelationKind,
  project: Schema.String,
  a: PeerPlanSide,
  b: PeerPlanSide,
  /** What the two meet at: the more specific of their two items. */
  item: PeerPlanItem,
  /** No `--maybe` is involved. */
  certain: Schema.Boolean,
  /** The changer's item came from what its session reported, not from a plan. */
  observed: Schema.Boolean,
  /** For a use of a provided symbol: the changer's contract line. */
  contract: Schema.optional(Schema.String),
});
export type PeerPlanRelation = typeof PeerPlanRelation.Type;

/** The plans and relations of the caller's projects, and how many relations the Hub's caps left out. */
export const PeerPlansView = Schema.Struct({
  plans: Schema.Array(PeerPlan),
  relations: Schema.Array(PeerPlanRelation),
  omitted: count,
  at: Schema.String,
});
export type PeerPlansView = typeof PeerPlansView.Type;

/** What a declaration answers: the plan now, the relations that name its session, and whether it made a new version. */
export const PeerPlanDeclared = Schema.Struct({
  plan: PeerPlan,
  relations: Schema.Array(PeerPlanRelation),
  omitted: count,
  changed: Schema.Boolean,
  at: Schema.String,
});
export type PeerPlanDeclared = typeof PeerPlanDeclared.Type;

/** The body of `POST …/plans/withdraw` and what it answers. */
export const PeerPlanWithdrawal = Schema.Struct({
  environment: Schema.String,
  session: Schema.optional(Schema.String),
  project: Schema.optional(Schema.String),
});
export type PeerPlanWithdrawal = typeof PeerPlanWithdrawal.Type;
export const PeerPlanWithdrawn = Schema.Struct({ withdrawn: count, at: Schema.String });
export type PeerPlanWithdrawn = typeof PeerPlanWithdrawn.Type;

/** Where a view is read: a workspace, narrowed to a project or one task. */
export const PeerPlansPlace = Schema.Struct({
  workspace: Schema.String,
  project: Schema.optional(Schema.String),
  task: Schema.optional(Schema.String),
  /** Cache key only; filtering and authorization use the place fields. */
  revision: Schema.optional(count),
});
export type PeerPlansPlace = typeof PeerPlansPlace.Type;

/**
 * The status field (`plans`, omitted while the plugin is inactive): counts only, so a row or badge
 * needs no view. A task's live plans and the live relations that name it; the detail is behind
 * `peer.plans.list`, read again when `revision` moves.
 */
export const PeerPlansStatus = Schema.Struct({
  enabled: Schema.Boolean,
  forcedOff: Schema.Boolean,
  hubSupport: Schema.Literals(["unknown", "supported", "unsupported"]),
  lastContact: Schema.optional(Schema.String),
  counts: Schema.Array(
    Schema.Struct({
      workspace: Schema.String,
      project: Schema.String,
      task: Schema.String,
      plans: count,
      relations: count,
    }),
  ),
  revision: count,
});
export type PeerPlansStatus = typeof PeerPlansStatus.Type;
