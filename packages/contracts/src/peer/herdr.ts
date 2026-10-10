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

export const PeerHubFocusAgentInput = Schema.Struct({
  paneId: TrimmedNonEmptyString,
  /**
   * Open a terminal attached to Peer's herdr first when none is attached. Clients that predate it
   * never send it and keep focusing only.
   */
  openWindow: Schema.optional(Schema.Boolean),
});
export type PeerHubFocusAgentInput = typeof PeerHubFocusAgentInput.Type;

export const PeerHubAgentInput = Schema.Struct({ agentId: TrimmedNonEmptyString });
export type PeerHubAgentInput = typeof PeerHubAgentInput.Type;

export const PeerHubPromptAgentInput = Schema.Struct({
  agentId: TrimmedNonEmptyString,
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(20_000)),
});
export type PeerHubPromptAgentInput = typeof PeerHubPromptAgentInput.Type;

/** The coding agents herdr can hook into, to resume them after herdr restarts. */
export const PeerHerdrIntegrationAgent = Schema.Literals(["claude", "codex"]);
export type PeerHerdrIntegrationAgent = typeof PeerHerdrIntegrationAgent.Type;

/**
 * The herdr this computer's agents run in: the person's own (`own`), the one Peer runs from its
 * bundled binary (`peer`), or none. `bundledVersion` is the version Peer ships; it is absent where
 * the build has no herdr binary.
 */
export const PeerHerdrRuntime = Schema.Struct({
  source: Schema.Literals(["own", "peer", "none"]),
  state: Schema.Literals(["running", "starting", "stopping", "off", "failed", "unavailable"]),
  version: Schema.optional(Schema.String),
  bundledVersion: Schema.optional(Schema.String),
  /** Agents the herdr in use runs now. */
  agents: Schema.Number,
  /** Of those, the agents herdr can bring back after a restart (their integration is installed). */
  resumable: Schema.Number,
  /** Peer's herdr runs an older version than `bundledVersion` and waits for its agents to end. */
  pendingUpgrade: Schema.optional(Schema.Boolean),
  /** The person's own herdr answers too, while Peer keeps using its own. */
  otherRunning: Schema.Boolean,
  /** Why the state is `failed` or `unavailable`, in words for a person. */
  reason: Schema.optional(Schema.String),
  /** Where herdr's server log is, when the state is `failed`. */
  log: Schema.optional(Schema.String),
  /** The shell command that attaches a terminal to Peer's herdr. */
  attachCommand: Schema.optional(Schema.String),
});
export type PeerHerdrRuntime = typeof PeerHerdrRuntime.Type;

export const PeerHerdrIntegration = Schema.Struct({
  agent: PeerHerdrIntegrationAgent,
  state: Schema.Literals(["installed", "outdated", "missing", "unavailable"]),
  reason: Schema.optional(Schema.String),
  /** The files installing or removing it changes, for the confirmation. */
  files: Schema.Array(Schema.String),
});
export type PeerHerdrIntegration = typeof PeerHerdrIntegration.Type;

/** The `herdr` field of the Peer status, present while the herdr plugin is active. */
export const PeerHerdrStatus = Schema.Struct({
  /** Whether Peer may run its own herdr (the owner's setting, on by default). */
  bundled: Schema.Boolean,
  runtime: PeerHerdrRuntime,
  integrations: Schema.Array(PeerHerdrIntegration),
});
export type PeerHerdrStatus = typeof PeerHerdrStatus.Type;

export const PeerHerdrSetRuntimeInput = Schema.Struct({ on: Schema.Boolean });
export type PeerHerdrSetRuntimeInput = typeof PeerHerdrSetRuntimeInput.Type;

export const PeerHerdrOpenTerminalInput = Schema.Struct({
  /** A pane to bring forward once the window is open. */
  paneId: Schema.optional(TrimmedNonEmptyString),
});
export type PeerHerdrOpenTerminalInput = typeof PeerHerdrOpenTerminalInput.Type;

export const PeerHerdrSetIntegrationInput = Schema.Struct({
  agent: PeerHerdrIntegrationAgent,
  installed: Schema.Boolean,
});
export type PeerHerdrSetIntegrationInput = typeof PeerHerdrSetIntegrationInput.Type;
