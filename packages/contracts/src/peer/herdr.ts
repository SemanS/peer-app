import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "../baseSchemas.ts";
import { PeerWorkStatus } from "./base.ts";

/**
 * herdr agents: the coding agents herdr (https://herdr.dev) runs on this computer, which Peer
 * shows, reports as work, and starts on a task.
 */

/** An agent herdr runs on this computer (https://herdr.dev), whatever started it. */
export const PeerLocalAgent = Schema.Struct({
  /**
   * `herdr:<agent>:<session id>` once Peer knows the agent's own session, so
   * it survives a pane or herdr restart; `herdr:<terminal id>` until then.
   */
  id: Schema.String,
  paneId: Schema.String,
  agent: Schema.optional(Schema.String),
  title: Schema.String,
  status: PeerWorkStatus,
  cwd: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  /** The workspace project whose checkout it runs in. */
  workspace: Schema.optional(Schema.String),
  projectId: Schema.optional(Schema.String),
  coordinationLevel: Schema.optional(Schema.Literals(["A", "B", "C"])),
  postHocPaths: Schema.optional(Schema.Array(Schema.String)),
  postHocPathsTruncated: Schema.optional(Schema.Number),
});
export type PeerLocalAgent = typeof PeerLocalAgent.Type;

export const PeerHubFocusAgentInput = Schema.Struct({ paneId: TrimmedNonEmptyString });
export type PeerHubFocusAgentInput = typeof PeerHubFocusAgentInput.Type;

export const PeerHubAgentInput = Schema.Struct({ agentId: TrimmedNonEmptyString });
export type PeerHubAgentInput = typeof PeerHubAgentInput.Type;

export const PeerHubPromptAgentInput = Schema.Struct({
  agentId: TrimmedNonEmptyString,
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(20_000)),
});
export type PeerHubPromptAgentInput = typeof PeerHubPromptAgentInput.Type;
