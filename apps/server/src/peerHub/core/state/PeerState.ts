/**
 * PeerState: this environment's Peer state, persisted in `peer-hub.json`.
 *
 * @module peerHub/core/state/PeerState
 */
import {
  PeerCoordinationPolicy,
  PeerJoinableWorkspace,
  PeerManifest,
  PeerWorkspaceRole,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const PersistedWorkspace = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  role: PeerWorkspaceRole,
  allowedDomains: Schema.Array(Schema.String),
  manifest: Schema.NullOr(PeerManifest),
  lastSyncAt: Schema.NullOr(Schema.String),
});
export type PersistedWorkspace = typeof PersistedWorkspace.Type;

export const PersistedState = Schema.Struct({
  hubUrl: Schema.NullOr(Schema.String),
  email: Schema.NullOr(Schema.String),
  pendingSignIn: Schema.NullOr(
    Schema.Struct({
      email: Schema.String,
      sentAt: Schema.String,
      echoedCode: Schema.optional(Schema.String),
    }),
  ),
  workspaces: Schema.Array(PersistedWorkspace),
  joinable: Schema.Array(PeerJoinableWorkspace),
  lastSyncAt: Schema.NullOr(Schema.String),
  /** "workspace/project" → provider instances this environment provisioned for its shared capacity. */
  sharedInstances: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  /** Address → workspaces that person left on this computer; signing in does not rejoin them. */
  leftWorkspaces: Schema.optional(Schema.Record(Schema.String, Schema.Array(Schema.String))),
  /** This computer's threads (`peer:<thread id>`, `herdr:<terminal id>`) → the task they work on. */
  assignments: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({ workspace: Schema.String, project: Schema.String, task: Schema.String }),
    ),
  ),
  /** "workspace/project/repository" → a checkout this computer shared from where it already was. */
  localCheckouts: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  /** Agents on the same project staying out of each other's way, on this computer (experimental). */
  coordination: Schema.optional(
    Schema.Struct({ enabled: Schema.Boolean, policy: PeerCoordinationPolicy }),
  ),
  /** This computer's threads (`peer:…`, `herdr:…`) whose owner lets the team watch them. */
  sharedThreads: Schema.optional(Schema.Array(Schema.String)),
});
export type PersistedState = typeof PersistedState.Type;
