import {
  PEER_SLACK_DELAYS,
  PEER_SLACK_MODES,
  type PeerSlackAdmin,
  type PeerSlackAdminResult,
  type PeerSlackChannel,
  type PeerSlackChannelChoice,
  type PeerSlackMe,
  type PeerSlackSaveSecretsInput,
  type PeerWorkspaceRole,
} from "@t3tools/contracts";
import {
  isSlackAdmin,
  slackLoad,
  slackMemberPart,
  slackModeLabel,
  slackSetupStep,
  slackStateLabel,
  type SlackFormat,
  type SlackMemberPart,
  type SlackSetupProblem,
  type SlackSetupStep,
} from "@t3tools/client-runtime/peer/slack";

interface SlackQuery<A> {
  readonly data: A | null;
  readonly error: string | null;
}

/**
 * What the Slack section of one workspace shows. An owner or admin gets the setup, a member never
 * does. Every member gets their options once Slack is connected; an owner or admin is led by the
 * setup until then, since nobody can link before it is done.
 */
export type SlackSectionView =
  | { readonly kind: "loading" }
  | { readonly kind: "older-hub" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly setup: SlackSetupView | null;
      readonly member: SlackMemberPart | null;
    };

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
  return {
    kind: "ready",
    setup: load.admin === null ? null : slackSetupView(load.admin),
    member: slackMemberPart(admin, load.me, format),
  };
}

/** Which parts of the setup show at a step. */
export interface SlackSetupBlocks {
  /** The button that opens Slack's page for creating the app. */
  readonly create: boolean;
  /** The bot token and signing secret fields. */
  readonly secrets: boolean;
  readonly verify: boolean;
  /** The default channel and a row per project. */
  readonly channels: boolean;
  /** The connection's health, Test and Disconnect. */
  readonly health: boolean;
}

/**
 * The secrets stay through Verify, since a token that Slack refuses or that was revoked is stored
 * again there. Once connected, channels and health take over; creating the app is behind.
 */
const BLOCKS = {
  create: { create: true, secrets: true, verify: false, channels: false, health: false },
  secrets: { create: false, secrets: true, verify: false, channels: false, health: false },
  verify: { create: false, secrets: true, verify: true, channels: false, health: false },
  channels: { create: false, secrets: false, verify: false, channels: true, health: true },
  connected: { create: false, secrets: false, verify: false, channels: true, health: true },
} as const satisfies Record<SlackSetupStep, SlackSetupBlocks>;

/** An owner's or admin's setup, as the connection's state decides it. */
export interface SlackSetupView {
  readonly admin: PeerSlackAdminResult;
  readonly step: SlackSetupStep;
  readonly stateLabel: string;
  /** The state's badge: connected is good, needing setup calls for attention, off is quiet. */
  readonly tone: "success" | "warning" | "outline";
  /** One line: whom Slack is connected to, or what to do next. */
  readonly summary: string;
  /** What the Hub reports as wrong with the app itself; a project's own show on its row. */
  readonly problems: ReadonlyArray<SlackSetupProblem>;
  readonly blocks: SlackSetupBlocks;
}

const SECRET_NAMES = { botToken: "bot token", signingSecret: "signing secret" } as const;

function stepSummary(step: SlackSetupStep, admin: PeerSlackAdmin) {
  switch (step) {
    case "create":
      return "Slack is not set up for this workspace yet.";
    case "secrets": {
      const missing = (Object.keys(SECRET_NAMES) as Array<keyof typeof SECRET_NAMES>)
        .filter((secret) => admin.secrets[secret] !== "stored")
        .map((secret) => SECRET_NAMES[secret]);
      return `Store the ${missing.join(" and ")}.`;
    }
    case "verify":
      return "Verify the stored token and signing secret with Slack.";
    case "channels":
      return `Connected to ${admin.team?.name ?? "Slack"}. Choose where agents post.`;
    case "connected":
      return `Connected to ${admin.team?.name ?? "Slack"}${admin.bot === null ? "" : ` as ${admin.bot.name}`}.`;
  }
}

export function slackSetupView(admin: PeerSlackAdminResult): SlackSetupView {
  const { step, problems } = slackSetupStep(admin);
  return {
    admin,
    step,
    stateLabel: slackStateLabel(admin.state),
    tone:
      admin.state === "connected"
        ? "success"
        : admin.state === "needs-setup"
          ? "warning"
          : "outline",
    summary: stepSummary(step, admin),
    problems: problems.filter((problem) => problem.project === undefined),
    blocks: BLOCKS[step],
  };
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

/** Why Test cannot post yet; the Hub posts it to the default channel. */
export const slackTestBlocker = (admin: PeerSlackAdmin) =>
  admin.default === null ? "Choose a default channel to send a test message." : null;

export const slackTestQueued = (admin: PeerSlackAdmin) =>
  `Test message queued${admin.default === null ? "" : ` for ${slackChannelLabel(admin.default)}`}. Choose Refresh to see how it went.`;

export const slackDisconnectConfirmation = (workspace: string) =>
  `Disconnect Slack from ${workspace}? Peer stops posting and ignores replies from Slack. Remove the Peer app in Slack as well; Peer cannot do that for you.`;

export const SLACK_DISCONNECTED =
  "Disconnected. Remove the Peer app in Slack as well; Peer cannot do that for you.";
