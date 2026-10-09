import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "../baseSchemas.ts";

/**
 * Observe: the team watches one of this computer's threads live while its owner shares it, through
 * the Hub's relay.
 */

/** Lets the team watch one of this computer's threads live, or stops it. */
export const PeerHubShareThreadInput = Schema.Struct({
  thread: TrimmedNonEmptyString,
  shared: Schema.Boolean,
});
export type PeerHubShareThreadInput = typeof PeerHubShareThreadInput.Type;

/** A colleague's shared thread: its workspace, the computer that reports it, its id there. */
export const PeerHubObserveInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  environment: TrimmedNonEmptyString,
  thread: TrimmedNonEmptyString,
});
export type PeerHubObserveInput = typeof PeerHubObserveInput.Type;
