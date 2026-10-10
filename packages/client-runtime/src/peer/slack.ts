// @effect-diagnostics globalDate:off -- Times read in the person's locale, in UI code outside an Effect runtime.
import {
  PEER_SLACK_DELAYS,
  PEER_SLACK_KINDS,
  PEER_SLACK_PLACES,
  WS_METHODS,
  type PeerSlackAdmin,
  type PeerSlackMe,
  type PeerWorkspaceRole,
} from "@t3tools/contracts";
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

/** Owners and admins connect Slack; every member links their own account and sets options. */
export const isSlackAdmin = (role: PeerWorkspaceRole) => role === "owner" || role === "admin";

/** What the Slack section says when the signed-in Hub has no Slack support. */
export const SLACK_OLDER_HUB_LINE = "This Peer Hub has no Slack support yet; it must be updated.";
/** What a member of a workspace without a Slack connection is told. */
export const SLACK_NOT_CONNECTED_LINE = "Slack is not connected yet; an admin can connect it.";
/** Why a member who has not linked cannot turn Slack on. */
export const SLACK_LINK_FIRST = "Link your Slack account first";

/**
 * Whether a failure says the Hub has no Slack support: the environment's own refusal (`Slack needs
 * a newer Peer Hub.`) or a Hub's route that is missing (`The Hub must be updated`). A query keeps
 * only the text of a failure, so this reads text.
 */
export function slackOlderHub(message: string) {
  return /\bneeds a newer (?:Peer )?Hub\b|\bHub must be updated\b|\bno Slack support\b/i.test(
    message,
  );
}

/** What a client has read of one query: `data` once it arrived, `error` when it failed. */
interface SlackQuery<A> {
  readonly data: A | null;
  readonly error: string | null;
}

/**
 * What the Slack section of one workspace shows from its queries. Members read their own view
 * (`me`); owners and admins also read the connection (`admin`). A failure outranks stale data, so
 * the section says what went wrong and offers Retry; a Hub with no Slack support is told apart,
 * since no retry helps.
 */
export type SlackLoad<A> =
  | { readonly kind: "loading" }
  | { readonly kind: "older-hub" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly me: PeerSlackMe; readonly admin: A | null };

export function slackLoad<A>(
  admin: boolean,
  queries: { readonly me: SlackQuery<PeerSlackMe>; readonly admin: SlackQuery<A> },
): SlackLoad<A> {
  for (const query of admin ? [queries.me, queries.admin] : [queries.me]) {
    if (query.error === null) continue;
    return slackOlderHub(query.error)
      ? { kind: "older-hub" }
      : { kind: "error", message: query.error };
  }
  const { me } = queries;
  if (me.data === null || (admin && queries.admin.data === null)) return { kind: "loading" };
  return { kind: "ready", me: me.data, admin: admin ? queries.admin.data : null };
}

/** How times read in what a member or an admin is told. */
export interface SlackFormat {
  /** A time of day, for what expires soon. */
  readonly time: (iso: string) => string;
  /** A date and time, for what happened. */
  readonly dateTime: (iso: string) => string;
}

const SLACK_FORMAT: SlackFormat = {
  time: (iso) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
  dateTime: (iso) =>
    new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
};

export type SlackLinkView =
  | { readonly kind: "linked"; readonly text: string }
  | { readonly kind: "pending"; readonly text: string }
  | { readonly kind: "none"; readonly text: string };

/**
 * Where a member's link stands, in the words they act on: linked, waiting for proof (a button in a
 * direct message, or a code to send the bot) or not linked. A request names the time it runs out;
 * once it has, the Hub reports no request and the next read says not linked.
 */
export function slackLinkView(
  me: Pick<PeerSlackMe, "link" | "pending" | "bot">,
  format: SlackFormat = SLACK_FORMAT,
): SlackLinkView {
  if (me.link !== null) return { kind: "linked", text: `Linked as ${me.link.name}` };
  const { pending } = me;
  if (pending === null) return { kind: "none", text: "Not linked" };
  const before = `before ${format.time(pending.expiresAt)}`;
  if (pending.kind === "dm") {
    return {
      kind: "pending",
      text: `Confirm in the direct message Peer sent to ${pending.name ?? "you"} in Slack, ${before}.`,
    };
  }
  if (pending.kind === "code" && pending.code !== undefined) {
    return {
      kind: "pending",
      text: `Send ${pending.code} to @${me.bot?.name ?? "Peer"} in a direct message in Slack, ${before}.`,
    };
  }
  return { kind: "pending", text: `Finish linking in Slack, ${before}.` };
}

/** A member's own part of the Slack section. */
export interface SlackMemberView {
  readonly link: SlackLinkView;
  /** Peer posts this member's waiting agents now. */
  readonly on: boolean;
  /** Why the switch cannot be turned on yet; null when it can. One that is on can always go off. */
  readonly switchReason: string | null;
  readonly delay: number;
  readonly place: string;
  readonly kinds: ReadonlyArray<string>;
}

export function slackMemberView(
  me: PeerSlackMe,
  format: SlackFormat = SLACK_FORMAT,
): SlackMemberView {
  const { enabled, delayMinutes, place, kinds } = me.settings;
  return {
    link: slackLinkView(me, format),
    on: enabled,
    switchReason: me.link === null && !enabled ? SLACK_LINK_FIRST : null,
    delay: delayMinutes,
    place,
    kinds,
  };
}

/** A member's part of the section: their options, or for a workspace without Slack, who to ask. */
export type SlackMemberPart =
  | { readonly kind: "unconnected" }
  | { readonly kind: "options"; readonly view: SlackMemberView };

/**
 * Every member gets their options once Slack is connected; until then a member is told to ask an
 * admin. An owner or admin gets nothing of their own yet: nobody can link before the connection is
 * done, which their setup leads through.
 */
export function slackMemberPart(
  admin: boolean,
  me: PeerSlackMe,
  format?: SlackFormat,
): SlackMemberPart | null {
  if (me.connected) return { kind: "options", view: slackMemberView(me, format) };
  return admin ? null : { kind: "unconnected" };
}

type SlackKind = (typeof PEER_SLACK_KINDS)[number];

/** The kinds after one is switched on or off, in the order Peer lists them. */
export const slackKindsWith = (kinds: ReadonlyArray<string>, kind: SlackKind, on: boolean) =>
  PEER_SLACK_KINDS.filter((candidate) => (candidate === kind ? on : kinds.includes(candidate)));

/** A delay as this build sends it; null for one only a newer Hub offers. */
export const slackDelayOf = (minutes: number) =>
  PEER_SLACK_DELAYS.find((candidate) => candidate === minutes) ?? null;

/** A place as this build sends it; null for one only a newer Hub offers. */
export const slackPlaceOf = (place: string) =>
  PEER_SLACK_PLACES.find((candidate) => candidate === place) ?? null;

/** The delays to offer: this build's, and the one the Hub holds if a newer build offers others. */
export const slackDelayChoices = (current: number): ReadonlyArray<number> =>
  (PEER_SLACK_DELAYS as ReadonlyArray<number>).includes(current)
    ? PEER_SLACK_DELAYS
    : [...PEER_SLACK_DELAYS, current].sort((a, b) => a - b);

/** The places to offer: this build's, and the one the Hub holds if a newer build offers others. */
export const slackPlaceChoices = (current: string): ReadonlyArray<string> =>
  (PEER_SLACK_PLACES as ReadonlyArray<string>).includes(current)
    ? PEER_SLACK_PLACES
    : [...PEER_SLACK_PLACES, current];

type SlackRow = { readonly label: string; readonly value: string };

/** The connection as an owner or admin reads it: state, and the Slack workspace and bot once verified. */
export function slackConnectionRows(admin: PeerSlackAdmin): ReadonlyArray<SlackRow> {
  return [
    { label: "State", value: slackStateLabel(admin.state) },
    ...(admin.team === null ? [] : [{ label: "Slack workspace", value: admin.team.name }]),
    ...(admin.bot === null ? [] : [{ label: "Bot", value: admin.bot.name }]),
  ];
}

/**
 * What the connection has done: the last post and last failure, how many members are linked and
 * how many agents wait for an answer.
 */
export function slackActivityRows(
  admin: PeerSlackAdmin,
  format: SlackFormat = SLACK_FORMAT,
): ReadonlyArray<SlackRow> {
  const { lastPostAt, lastFailure } = admin;
  return [
    {
      label: "Last post",
      value: lastPostAt === null ? "No post yet" : format.dateTime(lastPostAt),
    },
    {
      label: "Last failure",
      value:
        lastFailure === null
          ? "None"
          : `${slackProblemSentence(lastFailure.code)} (${format.dateTime(lastFailure.at)})`,
    },
    { label: "Linked members", value: String(admin.linkedMembers) },
    { label: "Waiting for an answer", value: String(admin.openAsks) },
  ];
}

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
