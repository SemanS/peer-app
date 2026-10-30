/**
 * The `reviewStarter` capability slot: a session with role `review` on a task, in a run of its own,
 * with the plugin's prompt instead of the review prompt. A plugin that needs a read-only agent
 * reaches `roles` through it, since plugins never import each other.
 *
 * @module peerHub/core/plugins/PeerReviewStarter
 */
import type {
  PeerHubError,
  PeerRolesStartReviewInput,
  PeerRolesStartReviewResult,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";

export interface PeerReviewStarter {
  readonly start: (
    input: PeerRolesStartReviewInput & { readonly prompt?: string },
  ) => Effect.Effect<PeerRolesStartReviewResult, PeerHubError>;
  /** The project's runs with role `review`, as this computer knows them. */
  readonly reviewRuns: (workspace: string, project: string) => Effect.Effect<ReadonlySet<string>>;
}
