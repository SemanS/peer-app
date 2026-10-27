import * as Schema from "effect/Schema";

export const PeerContextIdentity = Schema.Struct({
  backend: Schema.Literals(["local", "hub"]),
  authority: Schema.String,
  environment: Schema.String,
  workspace: Schema.String,
  project: Schema.String,
  /** project is work outside tasks; project-aggregate is a derived project overview. */
  scope: Schema.String,
});
export type PeerContextIdentity = typeof PeerContextIdentity.Type;
export const PeerContextSource = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["context", "task", "finding", "input"]),
  objectId: Schema.String,
  scope: Schema.String,
  revision: Schema.NullOr(Schema.String),
  observedAt: Schema.String,
  availability: Schema.Literals(["available", "empty", "unavailable", "disabled", "forbidden"]),
});
export const PeerContextValue = Schema.Struct({
  text: Schema.String,
  sourceRefs: Schema.Array(Schema.String),
  /** Markdown the short claim stands for (lists, tables, mappings), kept whole and shown collapsed. */
  detail: Schema.optional(Schema.String),
});
export const PeerContextCoverage = Schema.Struct({
  total: Schema.Number,
  omittedCount: Schema.Number,
  nextCursor: Schema.NullOr(Schema.String),
  historyAvailableFrom: Schema.NullOr(Schema.String),
});
export const PeerContextViewInput = Schema.Struct({
  workspace: Schema.String,
  project: Schema.String,
  scope: Schema.String,
  session: Schema.optional(Schema.String),
  environment: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  cursor: Schema.optional(Schema.String),
  inputCursor: Schema.optional(Schema.String),
  findingCursor: Schema.optional(Schema.String),
  conversationCursor: Schema.optional(Schema.String),
  /** How many conversations one page holds, apart from `limit` (the status report reads them all). */
  conversationLimit: Schema.optional(Schema.Number),
  /** Query cache invalidation only; never a claim that these sources were verified. */
  revision: Schema.optional(Schema.String),
});
export type PeerContextViewInput = typeof PeerContextViewInput.Type;
export const PeerConversationReport = Schema.Struct({
  state: Schema.Literals(["updating", "current", "partial", "unavailable", "error"]),
  updatedAt: Schema.NullOr(Schema.String),
  checkedAt: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  total: Schema.Number,
  available: Schema.Number,
  working: Schema.Number,
  waiting: Schema.Number,
  items: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      threadId: Schema.NullOr(Schema.String),
      title: Schema.String,
      status: Schema.String,
      archived: Schema.Boolean,
      updatedAt: Schema.NullOr(Schema.String),
      request: Schema.NullOr(Schema.String),
      response: Schema.NullOr(Schema.String),
      responseAt: Schema.NullOr(Schema.String),
      messages: Schema.Number,
      availability: Schema.Literals(["available", "partial", "unavailable"]),
      truncated: Schema.Boolean,
    }),
  ),
  coverage: PeerContextCoverage,
});
export type PeerConversationReport = typeof PeerConversationReport.Type;

export const PeerContextView = Schema.Struct({
  identity: PeerContextIdentity,
  /** Derived locally from conversations; never shared context or agent read evidence. */
  conversations: Schema.optional(PeerConversationReport),
  current: Schema.Struct({
    goal: Schema.Array(PeerContextValue),
    outcome: Schema.Array(PeerContextValue),
    attention: Schema.Array(PeerContextValue),
    next: Schema.Array(PeerContextValue),
  }),
  sources: Schema.Array(PeerContextSource),
  inputs: Schema.Struct({
    state: Schema.Literals(["complete", "revalidation-required", "unavailable"]),
    required: Schema.Array(
      Schema.Struct({
        scope: Schema.String,
        revision: Schema.Number,
        currentRevision: Schema.NullOr(Schema.Number),
        observedAt: Schema.String,
      }),
    ),
    coverage: PeerContextCoverage,
  }),
  pendingFindings: Schema.Struct({
    availability: Schema.Literals(["available", "unavailable"]),
    ids: Schema.Array(Schema.String),
    items: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        text: Schema.String,
        email: Schema.String,
        at: Schema.String,
        scope: Schema.String,
      }),
    ),
    coverage: PeerContextCoverage,
  }),
  coverage: PeerContextCoverage,
  generatedAt: Schema.String,
  /** Null unless a separate verification method supplied evidence. Assembly is not verification. */
  verifiedAt: Schema.NullOr(Schema.String),
});
export type PeerContextView = typeof PeerContextView.Type;
export const PeerContextArchiveInput = Schema.Struct({
  workspace: Schema.String,
  project: Schema.String,
  history: Schema.optional(Schema.Boolean),
  topic: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  cursor: Schema.optional(Schema.String),
  revision: Schema.optional(Schema.String),
});
export type PeerContextArchiveInput = typeof PeerContextArchiveInput.Type;
export const PeerContextArchive = Schema.Struct({
  identity: PeerContextIdentity,
  entries: Schema.Array(
    Schema.Struct({
      scope: Schema.String,
      title: Schema.String,
      gist: Schema.NullOr(Schema.String),
      revision: Schema.NullOr(Schema.Number),
      updatedAt: Schema.String,
      closed: Schema.Boolean,
    }),
  ),
  coverage: PeerContextCoverage,
  generatedAt: Schema.String,
  availability: Schema.Literals(["available", "empty", "unavailable", "disabled", "forbidden"]),
});
export type PeerContextArchive = typeof PeerContextArchive.Type;
