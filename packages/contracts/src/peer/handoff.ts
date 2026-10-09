import * as Schema from "effect/Schema";
export const PeerHandoffTarget = Schema.Literals(["description", "comment", "none"]);
export type PeerHandoffTarget = typeof PeerHandoffTarget.Type;
export const PeerHandoffPackage = Schema.Struct({
  number: Schema.Number,
  project: Schema.String,
  task: Schema.String,
  key: Schema.optional(Schema.String),
  title: Schema.String,
  author: Schema.String,
  source: Schema.Literals(["agent", "person"]),
  composedAt: Schema.String,
  context: Schema.NullOr(
    Schema.Struct({
      version: Schema.Number,
      updatedAt: Schema.String,
      gist: Schema.NullOr(Schema.String),
      sections: Schema.Array(
        Schema.Struct({
          name: Schema.Literals(["State", "Provides", "Decisions", "Blockers", "Next"]),
          shortened: Schema.Boolean,
          lines: Schema.Array(Schema.String),
        }),
      ),
      projectLines: Schema.Array(Schema.String),
    }),
  ),
  inputs: Schema.Array(
    Schema.Struct({
      scope: Schema.String,
      key: Schema.optional(Schema.String),
      title: Schema.optional(Schema.String),
      readVersion: Schema.Number,
      currentVersion: Schema.NullOr(Schema.Number),
    }),
  ),
  overlaps: Schema.Array(
    Schema.Struct({
      state: Schema.Literals(["settled", "open"]),
      files: Schema.Array(Schema.String),
      partner: Schema.NullOr(Schema.String),
      agreement: Schema.optional(Schema.String),
      at: Schema.String,
    }),
  ),
  pullRequests: Schema.Array(Schema.String),
});
export type PeerHandoffPackage = typeof PeerHandoffPackage.Type;
export const PeerHandoffSummary = Schema.Struct({
  project: Schema.String,
  task: Schema.String,
  author: Schema.String,
  number: Schema.Number,
  composedAt: Schema.String,
  contextVersion: Schema.NullOr(Schema.Number),
  pullRequests: Schema.Number,
  source: Schema.Literals(["agent", "person"]),
});
export type PeerHandoffSummary = typeof PeerHandoffSummary.Type;
export const PeerHandoffOutcome = Schema.Struct({
  workspace: Schema.String,
  project: Schema.String,
  task: Schema.String,
  number: Schema.NullOr(Schema.Number),
  changed: Schema.Boolean,
  contextVersion: Schema.NullOr(Schema.Number),
  stored: Schema.Boolean,
  targets: Schema.Array(
    Schema.Struct({
      url: Schema.String,
      kind: Schema.Literals(["written", "current", "skipped", "failed", "removed", "not-finished"]),
      reason: Schema.String,
    }),
  ),
  notices: Schema.Array(Schema.String),
});
export type PeerHandoffOutcome = typeof PeerHandoffOutcome.Type;
export const PeerHandoffStatus = Schema.Struct({
  target: PeerHandoffTarget,
  projectTargets: Schema.Record(Schema.String, PeerHandoffTarget),
  summaries: Schema.Array(
    Schema.Struct({ ...PeerHandoffSummary.fields, workspace: Schema.String }),
  ),
  deliveries: Schema.Array(PeerHandoffOutcome),
});
export type PeerHandoffStatus = typeof PeerHandoffStatus.Type;
export const PeerHandoffPlace = Schema.Struct({
  revision: Schema.optional(Schema.String),
  workspace: Schema.String,
  projectId: Schema.String,
  taskId: Schema.String,
});
export type PeerHandoffPlace = typeof PeerHandoffPlace.Type;
export const PeerHandoffSetTarget = Schema.Struct({
  target: PeerHandoffTarget,
  workspace: Schema.optional(Schema.String),
  projectId: Schema.optional(Schema.String),
});
export type PeerHandoffSetTarget = typeof PeerHandoffSetTarget.Type;
