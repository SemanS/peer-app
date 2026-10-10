import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "../baseSchemas.ts";

/**
 * Slack: a member's agents ask them in Slack when they wait, and the member's answer goes back to
 * the exact agent that asked. The Hub holds the connection and the conversation; these are the
 * shapes of its `/slack/me` and `/slack/admin` routes as the RPCs return them.
 *
 * States, modes, places, kinds and problem codes travel as plain strings, so a client decodes the
 * answer of a newer Hub and shows a value it does not know as text. The `PEER_SLACK_*` lists are
 * what this build offers and sends.
 */

/** Minutes a decision point stays open before it is posted. */
export const PEER_SLACK_DELAYS = [0, 2, 5, 15] as const;
/** Where a member wants their questions: the project's thread, or direct messages only. */
export const PEER_SLACK_PLACES = ["thread", "direct"] as const;
/** What can wait for a member and be posted. */
export const PEER_SLACK_KINDS = ["approval", "question", "finished", "blocked"] as const;
/** How an admin lets a project's agents post. A project the admin has not set reads `unset`. */
export const PEER_SLACK_MODES = ["thread", "direct", "off"] as const;

export const PeerSlackTeam = Schema.Struct({ id: Schema.String, name: Schema.String });
export type PeerSlackTeam = typeof PeerSlackTeam.Type;

/** The app's bot. A member sees its name; admins also get its user and, once Slack sent an event, its app id. */
export const PeerSlackBot = Schema.Struct({
  name: Schema.String,
  user: Schema.optional(Schema.String),
  app: Schema.optional(Schema.NullOr(Schema.String)),
});
export type PeerSlackBot = typeof PeerSlackBot.Type;

export const PeerSlackChannel = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  private: Schema.Boolean,
});
export type PeerSlackChannel = typeof PeerSlackChannel.Type;

/** What does not work: Slack's error code, or Peer's own (`not_in_channel`), and when it was seen. */
export const PeerSlackProblem = Schema.Struct({ code: Schema.String, at: Schema.String });
export type PeerSlackProblem = typeof PeerSlackProblem.Type;

export const PeerSlackLink = Schema.Struct({
  slackUser: Schema.String,
  name: Schema.String,
  linkedAt: Schema.String,
});
export type PeerSlackLink = typeof PeerSlackLink.Type;

/**
 * A link waiting for its proof: `dm` when the Slack user with the member's address was sent a
 * button (`name`), `code` when the member sends the one-time `code` to the bot.
 */
export const PeerSlackPending = Schema.Struct({
  kind: Schema.String,
  name: Schema.optional(Schema.String),
  code: Schema.optional(Schema.String),
  expiresAt: Schema.String,
});
export type PeerSlackPending = typeof PeerSlackPending.Type;

/** A member's options. Slack is off until they turn it on, which needs a link. */
export const PeerSlackSettings = Schema.Struct({
  enabled: Schema.Boolean,
  delayMinutes: Schema.Number,
  place: Schema.String,
  kinds: Schema.Array(Schema.String),
});
export type PeerSlackSettings = typeof PeerSlackSettings.Type;

/** A project the member can reach, with how an admin lets its agents post. */
export const PeerSlackMemberProject = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  mode: Schema.String,
});
export type PeerSlackMemberProject = typeof PeerSlackMemberProject.Type;

/** What the Hub shows any member of a workspace: whether Slack is connected, and their own link and options. */
export const PeerSlackMe = Schema.Struct({
  connected: Schema.Boolean,
  team: Schema.NullOr(PeerSlackTeam),
  bot: Schema.NullOr(PeerSlackBot),
  link: Schema.NullOr(PeerSlackLink),
  pending: Schema.NullOr(PeerSlackPending),
  settings: PeerSlackSettings,
  projects: Schema.Array(PeerSlackMemberProject),
});
export type PeerSlackMe = typeof PeerSlackMe.Type;

/** Whether each of the app's two secrets is stored (`stored` or `missing`); their values are never returned. */
export const PeerSlackSecrets = Schema.Struct({
  botToken: Schema.String,
  signingSecret: Schema.String,
});
export type PeerSlackSecrets = typeof PeerSlackSecrets.Type;

export const PeerSlackAdminProject = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** The project lists named members, so an admin has to set its mode before anything is posted. */
  restricted: Schema.Boolean,
  channel: Schema.NullOr(PeerSlackChannel),
  mode: Schema.String,
  problem: Schema.NullOr(PeerSlackProblem),
});
export type PeerSlackAdminProject = typeof PeerSlackAdminProject.Type;

/** What the Hub shows an owner or admin: the connection's state, channels, health and counts. */
export const PeerSlackAdmin = Schema.Struct({
  state: Schema.String,
  secrets: PeerSlackSecrets,
  team: Schema.NullOr(PeerSlackTeam),
  bot: Schema.NullOr(PeerSlackBot),
  verifiedAt: Schema.NullOr(Schema.String),
  auth: Schema.NullOr(PeerSlackProblem),
  default: Schema.NullOr(PeerSlackChannel),
  projects: Schema.Array(PeerSlackAdminProject),
  lastPostAt: Schema.NullOr(Schema.String),
  lastFailure: Schema.NullOr(PeerSlackProblem),
  linkedMembers: Schema.Number,
  openAsks: Schema.Number,
});
export type PeerSlackAdmin = typeof PeerSlackAdmin.Type;

/** The addresses Slack calls on the Hub, which the Slack app's manifest names. */
export const PeerSlackManifestUrls = Schema.Struct({
  eventsUrl: Schema.String,
  actionsUrl: Schema.String,
});
export type PeerSlackManifestUrls = typeof PeerSlackManifestUrls.Type;

/**
 * What every admin RPC answers: the Hub's view, and the Hub address this environment is signed in
 * to with the request addresses made of it, so a client can show or build the app's manifest.
 */
export const PeerSlackAdminResult = Schema.Struct({
  ...PeerSlackAdmin.fields,
  hubUrl: Schema.String,
  manifest: PeerSlackManifestUrls,
});
export type PeerSlackAdminResult = typeof PeerSlackAdminResult.Type;

/** A channel an admin can pick; `member` says the bot is in it already (a public one it joins itself). */
export const PeerSlackChannelChoice = Schema.Struct({
  ...PeerSlackChannel.fields,
  member: Schema.Boolean,
});
export type PeerSlackChannelChoice = typeof PeerSlackChannelChoice.Type;

export const PeerSlackChannels = Schema.Struct({ channels: Schema.Array(PeerSlackChannelChoice) });
export type PeerSlackChannels = typeof PeerSlackChannels.Type;

/** The test post was queued; the Hub posts it to the default channel. */
export const PeerSlackTestResult = Schema.Struct({ job: Schema.String });
export type PeerSlackTestResult = typeof PeerSlackTestResult.Type;

export const PeerSlackWorkspaceInput = Schema.Struct({ workspace: TrimmedNonEmptyString });
export type PeerSlackWorkspaceInput = typeof PeerSlackWorkspaceInput.Type;

/** Changes the caller's own options; what is left out stays as it is. */
export const PeerSlackSetMineInput = Schema.Struct({
  ...PeerSlackWorkspaceInput.fields,
  enabled: Schema.optional(Schema.Boolean),
  delayMinutes: Schema.optional(Schema.Literals(PEER_SLACK_DELAYS)),
  place: Schema.optional(Schema.Literals(PEER_SLACK_PLACES)),
  kinds: Schema.optional(Schema.Array(Schema.Literals(PEER_SLACK_KINDS))),
});
export type PeerSlackSetMineInput = typeof PeerSlackSetMineInput.Type;

/** A secret as pasted; the Hub seals it. Its own bound is 8,192 characters. */
const SecretText = TrimmedNonEmptyString.check(Schema.isMaxLength(8_192));

/** Stores the app's secrets as the workspace's sealed secrets; what is left out is not touched. */
export const PeerSlackSaveSecretsInput = Schema.Struct({
  ...PeerSlackWorkspaceInput.fields,
  botToken: Schema.optional(SecretText),
  signingSecret: Schema.optional(SecretText),
});
export type PeerSlackSaveSecretsInput = typeof PeerSlackSaveSecretsInput.Type;

const PeerSlackProjectPosting = Schema.Struct({
  /** A channel id; null gives the project the default channel again. */
  channel: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  mode: Schema.optional(Schema.Literals(PEER_SLACK_MODES)),
});

/**
 * Sets the default channel and, per project, a channel and a mode. A field left out stays as it
 * is, and a channel set to null is cleared.
 */
export const PeerSlackSetChannelsInput = Schema.Struct({
  ...PeerSlackWorkspaceInput.fields,
  default: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  projects: Schema.optional(Schema.Record(Schema.String, PeerSlackProjectPosting)),
});
export type PeerSlackSetChannelsInput = typeof PeerSlackSetChannelsInput.Type;

export const PeerSlackUnlinkMemberInput = Schema.Struct({
  ...PeerSlackWorkspaceInput.fields,
  email: TrimmedNonEmptyString,
});
export type PeerSlackUnlinkMemberInput = typeof PeerSlackUnlinkMemberInput.Type;

export const PEER_SLACK_PLUGIN = {
  id: "slack",
  title: "Slack",
  summary: "Post your waiting agents' questions in Slack and take your answers back to them.",
  hubFeature: { id: "slack", revision: 1 },
} as const;
