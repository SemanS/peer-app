import * as Schema from "effect/Schema";

import { PeerAcceptanceVia, PeerReviewPolicyMode, PeerReviewSignal } from "./acceptance.ts";
import {
  PeerTestReportItemKind,
  PeerTestReportResult,
  PeerTestReportSeen,
} from "./test-reports.ts";

export const PeerHandoffTarget = Schema.Literals(["description", "comment", "none"]);
export type PeerHandoffTarget = typeof PeerHandoffTarget.Type;
export const PeerHandoffReport = Schema.Struct({
  number: Schema.Number,
  result: Schema.Literals(["pass", "fail", "mixed"]),
  author: Schema.String,
  role: Schema.String,
  at: Schema.String,
  passed: Schema.Number,
  failed: Schema.Number,
  unverified: Schema.Number,
  unowned: Schema.Array(Schema.String),
});
export type PeerHandoffReport = typeof PeerHandoffReport.Type;
/** The task's current acceptance, from the Hub's `acceptance` feature: who gave it and when. */
export const PeerHandoffAcceptance = Schema.Struct({
  by: Schema.String,
  at: Schema.String,
  note: Schema.optional(Schema.String),
  /** `policy` when the project's review policy accepted it in the lead's name; absent from an older Hub. */
  via: Schema.optional(PeerAcceptanceVia),
});
export type PeerHandoffAcceptance = typeof PeerHandoffAcceptance.Type;
/**
 * Whether a handed-off change is reachable by others, as Peer observed it from git or Jujutsu on
 * the author's computer at `peer review` (never from the agent's words): `none` (a reported file
 * is untracked or has uncommitted changes), `local` (committed, not pushed), `shared` (a pushed
 * branch, an open pull request, or a Jujutsu change pushed to a remote) or `landed` (a merged pull
 * request or a change on trunk).
 */
export const PEER_HANDOFF_DELIVERY_STATES = ["none", "local", "shared", "landed"] as const;
export const PeerHandoffDeliveryState = Schema.Literals(PEER_HANDOFF_DELIVERY_STATES);
export type PeerHandoffDeliveryState = typeof PeerHandoffDeliveryState.Type;

/** What the app sends and the Hub keeps of a delivery's evidence: at most 20 paths per file state, 10 pull requests. */
export const PEER_HANDOFF_DELIVERY_LIMITS = { paths: 20, pullRequests: 10, ids: 20 } as const;

/**
 * The delivery's evidence, bounded: the reported files untracked or with uncommitted changes
 * (`none`), the branch, the commit, Jujutsu change ids and bookmarks, and pull request urls.
 */
export const PeerHandoffDeliveryEvidence = Schema.Struct({
  untracked: Schema.optional(Schema.Array(Schema.String)),
  uncommitted: Schema.optional(Schema.Array(Schema.String)),
  branch: Schema.optional(Schema.String),
  commit: Schema.optional(Schema.String),
  changes: Schema.optional(Schema.Array(Schema.String)),
  bookmarks: Schema.optional(Schema.Array(Schema.String)),
  pullRequests: Schema.optional(Schema.Array(Schema.String)),
});
export type PeerHandoffDeliveryEvidence = typeof PeerHandoffDeliveryEvidence.Type;

/**
 * The delivery fact of a handoff: its state and evidence, when Peer observed it (`observedAt`), on
 * which computer (`environment`, the environment id the label is read from) and from which
 * version control (`vcs`). Sent in the `peer review` body as `delivery` to a Hub whose `handoff`
 * schema is 3 or later, kept on the package and in the handoff summary of the status.
 */
export const PeerHandoffDelivery = Schema.Struct({
  state: PeerHandoffDeliveryState,
  evidence: PeerHandoffDeliveryEvidence,
  observedAt: Schema.String,
  environment: Schema.String,
  vcs: Schema.Literals(["git", "jj"]),
});
export type PeerHandoffDelivery = typeof PeerHandoffDelivery.Type;

/**
 * The review policy as the Hub evaluated it on an agent's handoff: its mode and version, the
 * signals it raised (in both modes) and whether it accepted the task in the same move.
 */
export const PeerHandoffPolicy = Schema.Struct({
  mode: PeerReviewPolicyMode,
  version: Schema.Number,
  signals: Schema.Array(PeerReviewSignal),
  accepted: Schema.Boolean,
});
export type PeerHandoffPolicy = typeof PeerHandoffPolicy.Type;

/**
 * A handoff's current signals, computed by the Hub from today's facts with the delivery last
 * observed (`GET /acceptance/{project}/{task}/signals`, `acceptance` revision 3). The facts come
 * with the signals, so a client tells whose move each one is without guessing. Reading it writes
 * nothing and never accepts; the package keeps the signals of the handoff. `evaluated` is false
 * with no agent handoff, and every field below `signals` is then absent.
 */
export const PeerHandoffSignals = Schema.Struct({
  evaluated: Schema.Boolean,
  at: Schema.String,
  signals: Schema.Array(PeerReviewSignal),
  handoff: Schema.optional(
    Schema.Struct({
      email: Schema.String,
      session: Schema.String,
      environment: Schema.String,
      at: Schema.String,
      mode: PeerReviewPolicyMode,
      version: Schema.Number,
      signals: Schema.Array(PeerReviewSignal),
      accepted: Schema.Boolean,
      delivery: Schema.optional(PeerHandoffDelivery),
    }),
  ),
  reports: Schema.optional(
    Schema.Array(
      Schema.Struct({
        author: Schema.String,
        role: Schema.String,
        number: Schema.Number,
        result: PeerTestReportResult,
        at: Schema.String,
      }),
    ),
  ),
  /** The governing reports' failed and unverified items; `failed` also covers what Peer saw fail. */
  items: Schema.optional(
    Schema.Array(
      Schema.Struct({
        kind: PeerTestReportItemKind,
        text: Schema.String,
        owner: Schema.optional(Schema.String),
        task: Schema.optional(Schema.String),
        seen: Schema.optional(PeerTestReportSeen),
        failed: Schema.Boolean,
        author: Schema.String,
        role: Schema.String,
        number: Schema.Number,
        index: Schema.Number,
      }),
    ),
  ),
  overlaps: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        sessions: Schema.Array(Schema.String),
        files: Schema.Array(Schema.String),
      }),
    ),
  ),
  ownerCalls: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        owner: Schema.String,
        state: Schema.String,
        paths: Schema.Array(Schema.String),
        task: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
  changedInputs: Schema.optional(
    Schema.Array(
      Schema.Struct({
        scope: Schema.String,
        readVersion: Schema.Number,
        currentVersion: Schema.NullOr(Schema.Number),
      }),
    ),
  ),
});
export type PeerHandoffSignals = typeof PeerHandoffSignals.Type;

/** `available` is false on a Hub that cannot say: the page then keeps the package's signals. */
export const PeerHandoffSignalsRead = Schema.Struct({
  available: Schema.Boolean,
  signals: Schema.optional(PeerHandoffSignals),
});
export type PeerHandoffSignalsRead = typeof PeerHandoffSignalsRead.Type;

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
  /**
   * The task's newest test report when one was filed, from the Hub's own rows: its result, author,
   * role, time, the counts of its items and the text of its unverified items without an owner. An
   * older Hub leaves it out, and an older app drops it on decoding.
   */
  report: Schema.optional(PeerHandoffReport),
  /**
   * The task's current acceptance when a lead gave one and the Hub serves acceptance. An older Hub
   * leaves it out, and an older app drops it on decoding.
   */
  acceptance: Schema.optional(PeerHandoffAcceptance),
  /** The delivery Peer observed at `peer review`. Absent from an older app or Hub: "not observed". */
  delivery: Schema.optional(PeerHandoffDelivery),
  /** The review policy's evaluation of an agent's handoff. Absent from a person's handoff and an older Hub. */
  policy: Schema.optional(PeerHandoffPolicy),
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
  /** The package's delivery, as on the package; absent from an older Hub. */
  delivery: Schema.optional(PeerHandoffDelivery),
  /** The package's policy evaluation, as on the package; absent from an older Hub. */
  policy: Schema.optional(PeerHandoffPolicy),
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
