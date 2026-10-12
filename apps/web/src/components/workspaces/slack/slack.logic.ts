import {
  PEER_SLACK_DELAYS,
  PEER_SLACK_MODES,
  type PeerSlackAdmin,
  type PeerSlackAdminResult,
  type PeerSlackChannel,
  type PeerSlackChannelChoice,
  type PeerSlackMe,
  type PeerSlackSaveSecretsInput,
  type PeerSlackSetChannelsInput,
  type PeerWorkspaceRole,
} from "@t3tools/contracts";
import {
  SLACK_OLDER_HUB_LINE,
  isSlackAdmin,
  slackLoad,
  slackMemberPart,
  slackModeLabel,
  slackSetupStep,
  type SlackFormat,
  type SlackMemberPart,
  type SlackSetupStep,
} from "@t3tools/client-runtime/peer/slack";

import type { ConnectionState, ConnectionStep } from "../../settings/connectionStatus.logic";

interface SlackQuery<A> {
  readonly data: A | null;
  readonly error: string | null;
}

// ---- the four numbered steps and the status they give ---------------------------------------------

/** The steps an admin takes; `connected` (see `slackSetupStep`) comes after the fourth. */
export type SlackStepId = Exclude<SlackSetupStep, "connected">;

export const SLACK_STEP_COUNT = 4;

/** The steps in the order an admin takes them. */
export const SLACK_STEP_ORDER: ReadonlyArray<SlackStepId> = [
  "create",
  "secrets",
  "verify",
  "channels",
];

interface SlackStepText {
  readonly n: 1 | 2 | 3 | 4;
  /** The stepper's heading for the step. */
  readonly title: string;
  /** Where the step happens when it is not in Peer alone. */
  readonly where: string;
  /** How a status line continues after "Step 3 of 4:". */
  readonly status: string;
}

export const SLACK_STEPS: Readonly<Record<SlackStepId, SlackStepText>> = {
  create: { n: 1, title: "Create the app in Slack", where: "In Slack", status: "create the app" },
  secrets: {
    n: 2,
    title: "Install it and copy two values",
    where: "In Slack, then here",
    status: "install it and copy two values",
  },
  verify: { n: 3, title: "Verify with Slack", where: "", status: "verify" },
  channels: {
    n: 4,
    title: "Choose where agents post",
    where: "",
    status: "choose where agents post",
  },
};

/** The number of the step the connection is at; null once it is connected. */
export const slackStepNumber = (step: SlackSetupStep): 1 | 2 | 3 | 4 | null =>
  step === "connected" ? null : SLACK_STEPS[step].n;

/**
 * Slack's status in the one language every connection speaks (`ConnectionStatus`): the props the
 * status line takes, apart from its action.
 */
export interface SlackStatus {
  readonly state: ConnectionState;
  readonly label?: string | undefined;
  readonly detail?: string | undefined;
  readonly step?: ConnectionStep | undefined;
  readonly checkedAt?: string | undefined;
}

/** A bot as people write it in Slack: `@peer`. */
export const slackBotHandle = (name: string) => `@${name.replace(/^@/, "")}`;

type SlackStatusInput = Pick<
  PeerSlackAdmin,
  "state" | "secrets" | "team" | "bot" | "verifiedAt" | "auth" | "default" | "projects"
>;

/**
 * Where Slack stands for the workspace, from the Hub's view of it. A problem is something the Hub
 * reports as wrong (Slack refusing the token, a channel the bot cannot post in); otherwise Slack
 * needs setup at the first step not done, which includes the values being stored but not verified:
 * the Hub says `off` until the first Verify, and that is not what an admin who just saved them
 * should read. Connected says to which Slack workspace and bot, and when Slack last confirmed it.
 *
 * The Hub cannot see the app being created in Slack. Where the admin said they did that (or opened
 * Slack to), `leftForSlack` moves the first step on, so the card says what its stepper says;
 * a status built without it (the Overview, which has no such hint) names the step the Hub can see.
 */
export function slackStatus(
  admin: SlackStatusInput,
  options: { readonly leftForSlack?: boolean } = {},
): SlackStatus {
  const { step, problems } = slackSetupStep(admin);
  const [first, ...more] = problems;
  if (first !== undefined) {
    const project =
      first.project === undefined
        ? null
        : (admin.projects.find((candidate) => candidate.id === first.project)?.name ??
          first.project);
    const also = more.length === 0 ? "" : ` (and ${more.length} more)`;
    return {
      state: "problem",
      detail: `${project === null ? "" : `${project}: `}${first.sentence}${also}`,
    };
  }
  const shown = step === "create" && options.leftForSlack === true ? "secrets" : step;
  if (shown !== "connected") {
    return {
      state: "setup",
      step: { n: SLACK_STEPS[shown].n, of: SLACK_STEP_COUNT, title: SLACK_STEPS[shown].status },
    };
  }
  const team = admin.team?.name ?? "Slack";
  return {
    state: "connected",
    detail: admin.bot === null ? team : `${team} as ${slackBotHandle(admin.bot.name)}`,
    checkedAt: admin.verifiedAt ?? undefined,
  };
}

/** What the status says while the connection has not been read, or cannot be. */
export const slackReadingStatus: SlackStatus = { state: "off", label: "Checking…" };

/** A Hub without Slack: not an error to retry, nothing an admin can do here. */
export const slackOlderHubStatus: SlackStatus = {
  state: "unavailable",
  detail: SLACK_OLDER_HUB_LINE,
};

/** The connection could not be read: the fact failed, so the status says Problem, not Off. */
export const slackUnreadableStatus = (message: string): SlackStatus => ({
  state: "problem",
  detail: `Could not read Slack: ${message}`,
});

/**
 * What a member's Slack page shows of one workspace: their own options once Slack is connected, and
 * until then who to ask. An owner or admin is led by the setup under Integrations until then, since
 * nobody can link before it is done.
 */
export type SlackSectionView =
  | { readonly kind: "loading" }
  | { readonly kind: "older-hub" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly member: SlackMemberPart | null };

export function slackSectionView(
  role: PeerWorkspaceRole,
  queries: {
    readonly me: SlackQuery<PeerSlackMe>;
    readonly admin: SlackQuery<PeerSlackAdminResult>;
  },
  format?: SlackFormat,
): SlackSectionView {
  const admin = isSlackAdmin(role);
  const load = slackLoad(admin, queries);
  if (load.kind !== "ready") return load;
  return { kind: "ready", member: slackMemberPart(admin, load.me, format) };
}

export type SlackSecretsInput =
  | { readonly kind: "empty" }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "ready"; readonly input: PeerSlackSaveSecretsInput };

/**
 * What Save sends: only the fields that were filled, since the Hub keeps what is left out. A bot
 * token starts with `xoxb-`; a user or app token pasted here would only fail later.
 */
export function slackSecretsInput(
  workspace: string,
  values: { readonly botToken: string; readonly signingSecret: string },
): SlackSecretsInput {
  const botToken = values.botToken.trim();
  const signingSecret = values.signingSecret.trim();
  if (botToken === "" && signingSecret === "") return { kind: "empty" };
  if (botToken !== "" && !/^(?:xoxe\.)?xoxb-/.test(botToken)) {
    return {
      kind: "invalid",
      message:
        "A bot token starts with xoxb-. Copy the Bot User OAuth Token from OAuth & Permissions.",
    };
  }
  return {
    kind: "ready",
    input: {
      workspace,
      ...(botToken === "" ? {} : { botToken }),
      ...(signingSecret === "" ? {} : { signingSecret }),
    },
  };
}

/** The picker's value for no channel; Slack's channel ids never look like it. */
export const NO_CHANNEL = "none";

export const slackChannelLabel = (channel: { readonly name: string; readonly private: boolean }) =>
  `#${channel.name}${channel.private ? " (private)" : ""}`;

/**
 * A channel picker's items: a first one for no channel, the channels Slack listed by name, and the
 * one already chosen when Slack no longer lists it (the bot left a private channel, say), so the
 * picker still shows what is set.
 */
export function slackChannelItems(
  channels: ReadonlyArray<PeerSlackChannelChoice>,
  current: PeerSlackChannel | null,
  none: string,
) {
  const listed = [...channels].sort((a, b) => a.name.localeCompare(b.name));
  const unlisted =
    current === null || listed.some((channel) => channel.id === current.id) ? [] : [current];
  return [
    { value: NO_CHANNEL, label: none },
    ...[...listed, ...unlisted].map((channel) => ({
      value: channel.id,
      label: slackChannelLabel(channel),
    })),
  ];
}

export const slackChannelFromValue = (value: string) => (value === NO_CHANNEL ? null : value);
export const slackModeFromValue = (value: string) =>
  PEER_SLACK_MODES.find((mode) => mode === value) ?? null;
export const slackDelayFromValue = (value: string) =>
  PEER_SLACK_DELAYS.find((minutes) => String(minutes) === value) ?? null;

/** One project of the channel step. */
export interface SlackProjectRow {
  readonly id: string;
  readonly name: string;
  /** Only named members see the project. */
  readonly restricted: boolean;
  /** A channel id, or `NO_CHANNEL` for the default channel. */
  readonly channel: string;
  /** The channel is moot where nothing goes to a channel. */
  readonly channelDisabled: boolean;
  readonly mode: string;
  /** The modes to choose, and one only the Hub can set (`unset`, a newer Hub's) as a disabled item. */
  readonly modes: ReadonlyArray<{
    readonly value: string;
    readonly label: string;
    readonly disabled: boolean;
  }>;
  /** What Slack reported about the project's channel, in a sentence. */
  readonly problem: string | null;
  /** What to do before anything is posted for the project, or null. */
  readonly note: string | null;
}

/**
 * A project open to every member posts as a thread in the default channel until an admin chooses
 * otherwise, so it reads as `thread`. Only a project with named members waits for the choice, and
 * shows `unset` until an admin makes it.
 */
export function slackProjectRows(admin: PeerSlackAdminResult): ReadonlyArray<SlackProjectRow> {
  const { problems } = slackSetupStep(admin);
  return admin.projects.map((project) => {
    const mode = project.mode === "unset" && !project.restricted ? "thread" : project.mode;
    const chosen = (PEER_SLACK_MODES as ReadonlyArray<string>).includes(mode);
    const note =
      mode === "unset"
        ? "Only listed members see this project, so nothing is posted until you choose a mode."
        : mode === "thread" && project.channel === null && admin.default === null
          ? "No channel yet: choose one here, or set a default channel."
          : null;
    return {
      id: project.id,
      name: project.name,
      restricted: project.restricted,
      channel: project.channel?.id ?? NO_CHANNEL,
      channelDisabled: mode === "direct" || mode === "off",
      mode,
      modes: [
        ...PEER_SLACK_MODES.map((value) => ({
          value,
          label: slackModeLabel(value),
          disabled: false,
        })),
        ...(chosen ? [] : [{ value: mode, label: slackModeLabel(mode), disabled: true }]),
      ],
      problem: problems.find((problem) => problem.project === project.id)?.sentence ?? null,
      note,
    };
  });
}

// ---- the default channel, and where each project posts ----------------------------------------------

/** The default picker's value for "Direct messages only", which is not a channel. */
export const DIRECT_ONLY = "direct-only";

type DefaultInput = Pick<PeerSlackAdmin, "default" | "projects">;

/**
 * What the default picker shows: the channel, or direct messages only (no channel, every project
 * posts in direct messages), or no place yet.
 */
export function slackDefaultValue(admin: DefaultInput): string {
  if (admin.default !== null) return admin.default.id;
  return admin.projects.length > 0 && admin.projects.every((project) => project.mode === "direct")
    ? DIRECT_ONLY
    : NO_CHANNEL;
}

/** The default picker's items: the channels as for a project, and direct messages when a project exists to post them. */
export function slackDefaultItems(
  channels: ReadonlyArray<PeerSlackChannelChoice>,
  admin: DefaultInput,
) {
  return [
    ...slackChannelItems(channels, admin.default, "No default channel"),
    ...(admin.projects.length === 0 ? [] : [{ value: DIRECT_ONLY, label: "Direct messages only" }]),
  ];
}

/**
 * What picking a value in the default picker saves. Direct messages only is every project's mode,
 * since the Hub has no default for it; leaving it for a channel (or none) puts those projects back
 * to threads, or they would keep posting in direct messages whatever the picker says.
 */
export function slackDefaultChange(
  admin: DefaultInput,
  value: string,
): Omit<PeerSlackSetChannelsInput, "workspace"> {
  const everyProject = (mode: "direct" | "thread") =>
    Object.fromEntries(admin.projects.map((project) => [project.id, { mode }]));
  if (value === DIRECT_ONLY) return { default: null, projects: everyProject("direct") };
  return {
    default: slackChannelFromValue(value),
    ...(slackDefaultValue(admin) === DIRECT_ONLY ? { projects: everyProject("thread") } : {}),
  };
}

/** One line of where agents post: the default, or a project that does not just follow it. */
export interface SlackPlaceRow {
  /** `default`, or the project's id. */
  readonly key: string;
  readonly label: string;
  readonly value: string;
  /** What Slack reported about the channel, in a sentence. */
  readonly problem: string | null;
}

/**
 * The default channel first, then each project whose posting differs from it: a channel of its own,
 * direct messages, off, or not chosen yet. A project that follows the default has no line, unless
 * Slack reported a problem with the channel it uses.
 */
export function slackPlaceRows(admin: PeerSlackAdminResult): ReadonlyArray<SlackPlaceRow> {
  const directOnly = slackDefaultValue(admin) === DIRECT_ONLY;
  const rows: Array<SlackPlaceRow> = [
    {
      key: "default",
      label: "Default channel",
      value:
        admin.default !== null
          ? slackChannelLabel(admin.default)
          : directOnly
            ? "Direct messages only"
            : "None",
      problem: null,
    },
  ];
  for (const row of slackProjectRows(admin)) {
    const own = admin.projects.find((project) => project.id === row.id)?.channel ?? null;
    const value = (() => {
      switch (row.mode) {
        case "thread":
          return own === null ? null : `Its own thread in ${slackChannelLabel(own)}`;
        case "direct":
          return directOnly ? null : slackModeLabel("direct");
        default:
          return slackModeLabel(row.mode);
      }
    })();
    const shown = value ?? (row.problem === null ? null : "Thread in the default channel");
    if (shown !== null)
      rows.push({ key: row.id, label: row.name, value: shown, problem: row.problem });
  }
  return rows;
}

/** Why Test cannot post yet; the Hub posts it to the default channel. */
export const slackTestBlocker = (admin: PeerSlackAdmin) =>
  admin.default === null ? "Choose a default channel to send a test message." : null;

export const slackTestQueued = (admin: PeerSlackAdmin) =>
  `Test message queued${admin.default === null ? "" : ` for ${slackChannelLabel(admin.default)}`}. Choose Refresh to see how it went.`;

export const slackDisconnectConfirmation = (workspace: string) =>
  `Disconnect Slack from ${workspace}? Peer stops posting and ignores replies from Slack. Remove the Peer app in Slack as well; Peer cannot do that for you.`;

export const SLACK_DISCONNECTED =
  "Disconnected. Remove the Peer app in Slack as well; Peer cannot do that for you.";
