import { WS_METHODS, type PeerSlackAdmin } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";

/**
 * The Slack app a workspace's admin creates from Peer: the bot scopes and events the feature uses,
 * the Hub's addresses for Slack to call (`<hub>/v1/workspaces/<slug>/slack/events` and `.../actions`)
 * and Socket Mode off. The Hub address is the one this environment is signed in to; a trailing
 * slash on it makes no difference.
 */
export function slackManifest(hubUrl: string, slug: string) {
  const base = `${hubUrl.trim().replace(/\/+$/, "")}/v1/workspaces/${encodeURIComponent(slug)}/slack`;
  return {
    display_information: {
      name: "Peer",
      description: "Your agents ask you here when they wait; answer in the thread.",
    },
    features: {
      bot_user: { display_name: "Peer", always_online: true },
      app_home: { messages_tab_enabled: true, messages_tab_read_only_enabled: false },
    },
    oauth_config: {
      scopes: {
        bot: [
          "chat:write",
          "channels:read",
          "channels:join",
          "channels:history",
          "groups:read",
          "groups:history",
          "im:write",
          "im:history",
          "reactions:write",
          "users:read",
          "users:read.email",
        ],
      },
    },
    settings: {
      event_subscriptions: {
        request_url: `${base}/events`,
        bot_events: ["message.channels", "message.groups", "message.im"],
      },
      interactivity: { is_enabled: true, request_url: `${base}/actions` },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}
export type SlackManifest = ReturnType<typeof slackManifest>;

/** Slack's page for creating an app, with the manifest already filled in. */
export function slackCreateAppUrl(manifest: SlackManifest) {
  return `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(manifest))}`;
}

/**
 * Where an admin is in connecting Slack, in order: `create` the app from the manifest, `secrets`
 * (store its bot token and signing secret), `verify` them with Slack, `channels` (pick where
 * agents post), `connected`.
 */
export type SlackSetupStep = "create" | "secrets" | "verify" | "channels" | "connected";

/** What does not work, as setup shows it: the app itself, or the channel of one project. */
export interface SlackSetupProblem {
  /** Slack's error code, or Peer's own (`not_in_channel`). */
  readonly code: string;
  /** One sentence for it; a code this build does not know is shown as it is. */
  readonly sentence: string;
  readonly at: string;
  /** The project whose channel it is; absent for a problem of the app. */
  readonly project?: string;
}

/** The part of the Hub's admin view that decides the step; every admin RPC answers a superset. */
type SlackAdminView = Pick<
  PeerSlackAdmin,
  "state" | "secrets" | "team" | "verifiedAt" | "auth" | "default" | "projects"
>;

const stored = (state: string) => state === "stored";

/**
 * The first step an admin has not finished, and what the Hub reports as wrong. Steps after
 * `verify` need the Hub to call the connection `connected`, whatever else the view holds, so a
 * revoked token or a disconnected workspace sends the admin back to `verify`. Agents can post once
 * there is a place for them: the default channel, a project's own channel or direct messages.
 */
export function slackSetupStep(admin: SlackAdminView) {
  const { botToken, signingSecret } = admin.secrets;
  const problems: Array<SlackSetupProblem> = [];
  if (admin.auth !== null) {
    problems.push({
      code: admin.auth.code,
      sentence: slackProblemSentence(admin.auth.code),
      at: admin.auth.at,
    });
  }
  for (const project of admin.projects) {
    if (project.problem === null) continue;
    problems.push({
      code: project.problem.code,
      sentence: slackProblemSentence(project.problem.code),
      at: project.problem.at,
      project: project.id,
    });
  }
  const step = ((): SlackSetupStep => {
    if (!stored(botToken) && !stored(signingSecret)) return "create";
    if (!stored(botToken) || !stored(signingSecret)) return "secrets";
    const verified =
      admin.state === "connected" && admin.verifiedAt !== null && admin.auth === null;
    if (!verified || admin.team === null) return "verify";
    const hasPlace =
      admin.default !== null ||
      admin.projects.some((project) => project.channel !== null || project.mode === "direct");
    return hasPlace ? "connected" : "channels";
  })();
  return { step, problems };
}

const STATES: Readonly<Record<string, string>> = {
  off: "Off",
  "needs-setup": "Needs setup",
  connected: "Connected",
};
export const slackStateLabel = (state: string) => STATES[state] ?? state;

const KINDS: Readonly<Record<string, string>> = {
  approval: "Approvals",
  question: "Questions",
  finished: "Finished turns",
  blocked: "Blocked prompts",
};
export const slackKindLabel = (kind: string) => KINDS[kind] ?? kind;

/** How an admin lets a project's agents post. */
const MODES: Readonly<Record<string, string>> = {
  thread: "Thread in the channel",
  direct: "Direct messages only",
  off: "Off",
  unset: "Not set",
};
export const slackModeLabel = (mode: string) => MODES[mode] ?? mode;

/** Where a member wants their questions. */
const PLACES: Readonly<Record<string, string>> = {
  thread: "Thread in the project's channel",
  direct: "Direct messages only",
};
export const slackPlaceLabel = (place: string) => PLACES[place] ?? place;

export const slackDelayLabel = (minutes: number) =>
  minutes === 0 ? "Right away" : `After ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;

const PROBLEMS: Readonly<Record<string, string>> = {
  invalid_auth: "Slack does not accept the bot token; store it again and choose Verify.",
  not_authed: "Slack received no bot token; store it and choose Verify.",
  token_revoked:
    "The bot token was revoked in Slack; install the app again, store the new token and choose Verify.",
  token_expired:
    "The bot token expired; install the app again, store the new token and choose Verify.",
  account_inactive: "The Slack workspace or the bot's user was deleted or deactivated.",
  missing_scope:
    "The Slack app lacks a permission Peer needs; create it again from Peer's manifest.",
  channel_not_found: "Slack cannot find this channel; pick it again.",
  not_in_channel: "Invite @Peer to the channel.",
  is_archived: "The channel is archived; pick another one.",
  ratelimited: "Slack is limiting how fast Peer may post; Peer tries again by itself.",
  request_timeout: "Slack did not answer in time; Peer tries again by itself.",
  internal_error: "Slack had a problem on its side; Peer tries again by itself.",
  service_unavailable: "Slack had a problem on its side; Peer tries again by itself.",
  fatal_error: "Slack had a problem on its side; Peer tries again by itself.",
};
/** A problem's code in a sentence; a code this build does not know stays as the Hub sent it. */
export const slackProblemSentence = (code: string) => PROBLEMS[code] ?? code;

/** Opened queries and explicit actions only; no timer or polling. */
export function createSlackEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    me: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:peer:slack:me",
      tag: WS_METHODS.peerSlackMe,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    admin: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:peer:slack:admin",
      tag: WS_METHODS.peerSlackAdmin,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    channels: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:peer:slack:channels",
      tag: WS_METHODS.peerSlackChannels,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    setMine: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer:slack:set-mine",
      tag: WS_METHODS.peerSlackSetMine,
    }),
    link: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer:slack:link",
      tag: WS_METHODS.peerSlackLink,
    }),
    unlink: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer:slack:unlink",
      tag: WS_METHODS.peerSlackUnlink,
    }),
    saveSecrets: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer:slack:save-secrets",
      tag: WS_METHODS.peerSlackSaveSecrets,
    }),
    verify: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer:slack:verify",
      tag: WS_METHODS.peerSlackVerify,
    }),
    setChannels: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer:slack:set-channels",
      tag: WS_METHODS.peerSlackSetChannels,
    }),
    test: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer:slack:test",
      tag: WS_METHODS.peerSlackTest,
    }),
    unlinkMember: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer:slack:unlink-member",
      tag: WS_METHODS.peerSlackUnlinkMember,
    }),
    disconnect: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer:slack:disconnect",
      tag: WS_METHODS.peerSlackDisconnect,
    }),
  };
}
