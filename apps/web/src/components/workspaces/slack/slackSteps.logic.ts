/**
 * What the Slack setup says and remembers, apart from how it draws (design artboards 4a-4c): the
 * four numbered steps with the one an admin returns to, the hints kept in this browser for the steps
 * that happen in Slack, what Verify found out about the Slack workspace, the scopes in words and the
 * two addresses of an app that already exists. The Hub's view decides what is done; the hints only
 * decide where the stepper opens for what Peer cannot see (that the app was created in Slack).
 */
import {
  slackCreateAppUrl,
  slackManifest,
  slackProblemSentence,
  slackSetupStep,
} from "@t3tools/client-runtime/peer/slack";
import type {
  PeerSlackAdmin,
  PeerSlackAdminResult,
  PeerSlackSaveSecretsInput,
} from "@t3tools/contracts";

import {
  SLACK_STEPS,
  SLACK_STEP_COUNT,
  SLACK_STEP_ORDER,
  slackHandle,
  slackSecretsInput,
  type SlackStatusHints,
  type SlackStepId,
} from "./slack.logic";

// ---- what the admin did in Slack, kept in this browser ----------------------------------------------

/** The two things to check in Slack's dialog, which step 1 lets an admin tick as they go. */
const SLACK_TICKS = ["workspace", "permissions"] as const;
export type SlackTick = (typeof SLACK_TICKS)[number];

/**
 * What the admin did in Slack, which Peer cannot see: when it opened Slack's page for creating the
 * app, that they ticked "I’ve done this", the checks they ticked, and the Slack workspace they
 * confirmed after Verify. Kept per workspace in this browser; they are hints, so the Hub's state wins
 * whenever it knows more (a stored value means the app exists).
 */
export interface SlackHints {
  readonly openedAt: string | null;
  readonly created: boolean;
  readonly ticks: ReadonlyArray<string>;
  /** The id of the Slack workspace the admin accepted as the one Peer should use. */
  readonly confirmedTeam: string | null;
}

export const EMPTY_SLACK_HINTS: SlackHints = {
  openedAt: null,
  created: false,
  ticks: [],
  confirmedTeam: null,
};

export const slackHintsKey = (workspace: string) => `peer:slack-setup:${workspace}`;

export const hintOpened = (hints: SlackHints, at: string): SlackHints => ({
  ...hints,
  openedAt: at,
});

export const hintCreated = (hints: SlackHints, created: boolean): SlackHints => ({
  ...hints,
  created,
});

export const hintTicked = (hints: SlackHints, tick: SlackTick, on: boolean): SlackHints => ({
  ...hints,
  ticks: on
    ? hints.ticks.includes(tick)
      ? hints.ticks
      : [...hints.ticks, tick]
    : hints.ticks.filter((candidate) => candidate !== tick),
});

export const hintConfirmed = (hints: SlackHints, team: string | null): SlackHints => ({
  ...hints,
  confirmedTeam: team,
});

/** The admin left for Slack or said the app is created. */
const leftForSlack = (hints: SlackHints) => hints.created || hints.openedAt !== null;

// ---- the Slack workspace the values belong to -----------------------------------------------------

const squash = (text: string) =>
  text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

/**
 * Whether the Slack workspace's name plausibly is the Peer workspace's: one contains the other once
 * only letters and digits are compared, against the workspace's name and its address. A name that
 * says nothing (too short, or empty) is not held against the admin.
 */
export function slackTeamLooksRight(
  team: string,
  workspace: { readonly name: string; readonly slug: string },
): boolean {
  const slack = squash(team);
  if (slack.length < 3) return true;
  return [squash(workspace.name), squash(workspace.slug)].some(
    (own) => own.length >= 3 && (slack.includes(own) || own.includes(slack)),
  );
}

/** What Verify found out, from the Hub's view of the connection and what the admin accepted. */
export type SlackVerifyResult =
  | { readonly kind: "pending" }
  | { readonly kind: "rejected"; readonly code: string; readonly text: string }
  | {
      readonly kind: "verified";
      readonly team: { readonly id: string; readonly name: string };
      /** `@peer`, when the Hub named the bot. */
      readonly bot: string | null;
      /** The Slack workspace's name looks like the Peer workspace's. */
      readonly looksRight: boolean;
      /** The admin accepted it (or the workspace already posts through it). */
      readonly confirmed: boolean;
    };

/** What Slack refusing the token means for the admin, for the codes a token can fail with. */
const REFUSED_TOKEN =
  "The token was revoked or copied incompletely. Copy it again from OAuth & Permissions; reinstalling the app makes a new one.";
const REJECTED: Readonly<Record<string, string>> = {
  invalid_auth: REFUSED_TOKEN,
  token_revoked: REFUSED_TOKEN,
};

type VerifyInput = Pick<
  PeerSlackAdmin,
  "state" | "secrets" | "team" | "bot" | "verifiedAt" | "auth" | "default" | "projects"
>;

export function slackVerifyResult(
  admin: VerifyInput,
  workspace: { readonly name: string; readonly slug: string },
  hints: SlackHints,
): SlackVerifyResult {
  if (admin.auth !== null) {
    return {
      kind: "rejected",
      code: admin.auth.code,
      text: REJECTED[admin.auth.code] ?? slackProblemSentence(admin.auth.code),
    };
  }
  const { step } = slackSetupStep(admin);
  if ((step !== "channels" && step !== "connected") || admin.team === null) {
    return { kind: "pending" };
  }
  return {
    kind: "verified",
    team: admin.team,
    bot: admin.bot === null ? null : slackHandle(admin.bot.name),
    looksRight: slackTeamLooksRight(admin.team.name, workspace),
    confirmed: step === "connected" || hints.confirmedTeam === admin.team.id,
  };
}

// ---- the steps -----------------------------------------------------------------------------------

export type SlackStepState = "done" | "current" | "later";

export interface SlackStepRow {
  readonly id: SlackStepId;
  readonly n: 1 | 2 | 3 | 4;
  readonly title: string;
  readonly where: string;
  readonly state: SlackStepState;
  /** A done step says what was done; the current one "Now"; one to come "Later". */
  readonly summary: string;
}

export interface SlackSteps {
  readonly rows: ReadonlyArray<SlackStepRow>;
  /** The first step not done; null once all four are. */
  readonly current: SlackStepId | null;
  /** What the admin is told on returning mid-way; null at the start and when done. */
  readonly resume: string | null;
  /** "Step 2 of 4", or "Done". */
  readonly progress: string;
}

export interface SlackStepsInput {
  readonly admin: VerifyInput;
  readonly hints: SlackHints;
  readonly workspace: { readonly name: string; readonly slug: string };
  /** "4 min ago" for a time the admin acted. */
  readonly ago: (iso: string) => string;
}

const stored = (value: string) => value === "stored";

/** Where the default channel is told in a sentence: its name, or direct messages. */
export function slackPlaceSentence(
  admin: Pick<PeerSlackAdmin, "default" | "projects">,
): string | null {
  if (admin.default !== null) {
    return `#${admin.default.name}${admin.default.private ? " (private)" : ""}`;
  }
  const own = admin.projects.find((project) => project.channel !== null);
  if (own?.channel) return `#${own.channel.name}`;
  return admin.projects.some((project) => project.mode === "direct") ? "direct messages" : null;
}

/**
 * The four steps with their state: what the Hub's view says is done, and for the one thing it cannot
 * see (the app created in Slack) what the admin did here. The stepper opens at `current`. A verified
 * app waits for the admin to confirm whose it is before the channels come: Peer found the Slack
 * workspace and bot, and the admin knows which one they meant.
 */
export function slackSteps(input: SlackStepsInput): SlackSteps {
  const { admin, hints, workspace, ago } = input;
  const hub = slackSetupStep(admin).step;
  const verify = slackVerifyResult(admin, workspace, hints);
  const storedAny = stored(admin.secrets.botToken) || stored(admin.secrets.signingSecret);

  const current: SlackStepId | null =
    hub === "connected"
      ? null
      : hub === "create"
        ? leftForSlack(hints)
          ? "secrets"
          : "create"
        : hub === "channels"
          ? verify.kind === "verified" && verify.confirmed
            ? "channels"
            : "verify"
          : hub;

  const at = current === null ? SLACK_STEP_ORDER.length : SLACK_STEP_ORDER.indexOf(current);
  const place = slackPlaceSentence(admin);
  const created = (() => {
    if (admin.team !== null) return `Created in ${admin.team.name}`;
    if (hints.created || storedAny) return "Created in Slack";
    return hints.openedAt === null ? "Created in Slack" : `Opened Slack ${ago(hints.openedAt)}`;
  })();
  const done: Readonly<Record<SlackStepId, string>> = {
    create: created,
    secrets: "Bot token and signing secret stored",
    verify:
      admin.team === null
        ? "Verified"
        : `${admin.team.name}${admin.bot === null ? "" : ` · ${slackHandle(admin.bot.name)}`}`,
    channels: place === null ? "Done" : place,
  };

  const rows = SLACK_STEP_ORDER.map((id, index): SlackStepRow => {
    const state: SlackStepState = index < at ? "done" : index === at ? "current" : "later";
    const text = SLACK_STEPS[id];
    return {
      id,
      n: text.n,
      title: text.title,
      where: text.where,
      state,
      summary: state === "done" ? done[id] : state === "current" ? "Now" : "Later",
    };
  });

  return {
    rows,
    current,
    resume: current === null ? null : resumeText({ ...input, current, verify }),
    progress: current === null ? "Done" : `Step ${at + 1} of ${SLACK_STEP_COUNT}`,
  };
}

/** What the admin is told on returning, from what they and the Hub did last. */
function resumeText(
  input: SlackStepsInput & {
    readonly current: SlackStepId;
    readonly verify: SlackVerifyResult;
  },
): string | null {
  const { admin, hints, workspace, ago, current, verify } = input;
  switch (current) {
    case "create":
      return null;
    case "secrets": {
      const { botToken, signingSecret } = admin.secrets;
      if (stored(botToken) !== stored(signingSecret)) {
        return stored(botToken)
          ? "The bot token is stored. Next: copy the signing secret."
          : "The signing secret is stored. Next: copy the bot token.";
      }
      return hints.openedAt !== null
        ? `You opened Slack ${ago(hints.openedAt)}. Next: install the app and copy two values.`
        : "The app is created. Next: install it and copy two values.";
    }
    case "verify":
      if (verify.kind === "rejected") {
        return "Slack did not accept the values. Fix them, then verify again.";
      }
      if (verify.kind === "verified") {
        return verify.looksRight
          ? `Slack says these values belong to ${verify.team.name}. Next: check that this is the workspace you mean.`
          : `Slack says these values belong to ${verify.team.name}, which does not look like ${workspace.name}. Check it before going on.`;
      }
      return "Both values are stored. Next: let Slack confirm them.";
    case "channels":
      return "Verified. Last step: where agents post.";
  }
}

/** The step before and after one, for Back and Next; null at the ends. */
export function slackStepBefore(id: SlackStepId): SlackStepId | null {
  return SLACK_STEP_ORDER[SLACK_STEP_ORDER.indexOf(id) - 1] ?? null;
}

export function slackStepAfter(id: SlackStepId): SlackStepId | null {
  return SLACK_STEP_ORDER[SLACK_STEP_ORDER.indexOf(id) + 1] ?? null;
}

/** What the admin's hints change in the status the card names; see `slackStatus`. */
export function slackStatusHints(
  admin: VerifyInput,
  workspace: { readonly name: string; readonly slug: string },
  hints: SlackHints,
): SlackStatusHints {
  const verify = slackVerifyResult(admin, workspace, hints);
  return {
    leftForSlack: leftForSlack(hints),
    unconfirmed: verify.kind === "verified" && !verify.confirmed,
  };
}

/** Where setup opens when the admin returns: the stepper once anything was done, else the two ways in. */
export function slackStartingFlow(admin: VerifyInput, hints: SlackHints): "choose" | "create" {
  return slackSetupStep(admin).step !== "create" || leftForSlack(hints) ? "create" : "choose";
}

export type SlackFlow = "choose" | "existing" | "create";

/**
 * Which part of the setup shows: what the admin picked, else where setup opens. A finished setup
 * shows the stepper at its end whatever was picked, and the two ways in are only for a setup nothing
 * has started: a Hub that already holds a value, or a hint of Slack opened, goes on from there.
 */
export function slackFlow(input: {
  readonly chosen: SlackFlow | null;
  readonly admin: VerifyInput;
  readonly hints: SlackHints;
  /** All four steps are done. */
  readonly done: boolean;
}): SlackFlow {
  const starting = slackStartingFlow(input.admin, input.hints);
  const wanted = input.chosen ?? starting;
  return input.done || (wanted === "choose" && starting !== "choose") ? "create" : wanted;
}

/** The final line of a finished setup. */
export function slackDoneText(
  admin: Pick<PeerSlackAdmin, "default" | "projects">,
  workspaceName: string,
): string {
  const place = slackPlaceSentence(admin);
  return `Connected. Agents in ${workspaceName} can now ask people${place === null ? "" : ` in ${place}`}. Tell the team to check Me › Slack.`;
}

// ---- what the overview of the setup says -----------------------------------------------------------

/** The four steps as the card shows them before setup starts: a short name and what it is. */
export const SLACK_OVERVIEW: ReadonlyArray<{
  readonly id: SlackStepId;
  readonly title: string;
  readonly sub: string;
}> = [
  { id: "create", title: "Create the app", sub: "In Slack, from Peer’s manifest" },
  { id: "secrets", title: "Store two values", sub: "Bot token and signing secret" },
  { id: "verify", title: "Verify", sub: "Slack confirms workspace and bot" },
  { id: "channels", title: "Choose where agents post", sub: "A default channel or DMs" },
];

/** What Slack does and how it differs from webhooks, in two sentences. */
export const SLACK_PURPOSE =
  "Agents ask people in Slack while they wait, and each answer goes back to the agent’s task. Webhooks only post events to a channel: nobody can answer an agent through a webhook.";

/** Before Slack is connected: why the workspace needs an app of its own. */
export const slackNeedsApp = (workspaceName: string) =>
  `${workspaceName} needs its own Slack app for this; Peer helps you create one or connect the one you have.`;

/** The hint under the two ways in. */
export const slackAppListHint = (workspaceName: string) =>
  `If ${workspaceName} already lists an app called Peer, connect that one rather than making a second.`;

export const SLACK_APPS_URL = "https://api.slack.com/apps";

// ---- the scopes in words -----------------------------------------------------------------------------

export interface SlackScopeGroup {
  readonly what: string;
  readonly why: string;
  /** Slack’s own names, shown small. */
  readonly ids: ReadonlyArray<string>;
}

/** What the app may do, by what Peer does with it; together they are the manifest's scopes. */
export const SLACK_SCOPE_GROUPS: ReadonlyArray<SlackScopeGroup> = [
  {
    what: "Post and ask",
    why: "Post an agent’s question to the person it waits for, and mark it when answered.",
    ids: ["chat:write", "im:write", "reactions:write"],
  },
  {
    what: "Read the answers",
    why: "Read replies in Peer’s threads and direct messages. Other messages are ignored.",
    ids: ["channels:history", "groups:history", "im:history"],
  },
  {
    what: "Find people by email",
    why: "Match a Slack person to their Peer account.",
    ids: ["users:read", "users:read.email"],
  },
  {
    what: "See and join channels",
    why: "List channels for you to choose from, and join the one you pick.",
    ids: ["channels:read", "channels:join", "groups:read"],
  },
];

// ---- an app that already exists ----------------------------------------------------------------------

export interface SlackAppUrl {
  readonly id: "events" | "actions";
  /** Where in Slack’s app settings the address goes. */
  readonly where: string;
  readonly url: string;
}

/**
 * What an admin compares with the app they have: the two addresses the Hub answers on, the bot
 * events and how many scopes a new app gets.
 */
export function slackExistingFacts(
  admin: Pick<PeerSlackAdminResult, "hubUrl" | "manifest">,
  workspace: string,
) {
  const manifest = slackManifest(admin.hubUrl, workspace);
  return {
    urls: [
      {
        id: "events",
        where: "Event Subscriptions › Request URL",
        url: admin.manifest.eventsUrl,
      },
      {
        id: "actions",
        where: "Interactivity & Shortcuts › Request URL",
        url: admin.manifest.actionsUrl,
      },
    ] as const satisfies ReadonlyArray<SlackAppUrl>,
    botEvents: manifest.settings.event_subscriptions.bot_events,
    scopeCount: manifest.oauth_config.scopes.bot.length,
  };
}

/** Slack’s page for creating the app, with Peer’s settings filled in, and the Hub it is made for. */
export function slackCreateFacts(admin: Pick<PeerSlackAdminResult, "hubUrl">, workspace: string) {
  const host = (() => {
    try {
      return new URL(admin.hubUrl).host;
    } catch {
      return admin.hubUrl;
    }
  })();
  return { url: slackCreateAppUrl(slackManifest(admin.hubUrl, workspace)), host };
}

// ---- storing the values and verifying them ---------------------------------------------------------

/** What the button that stores the two values and asks Slack does. */
export type SlackVerifyPlan =
  | { readonly kind: "blocked"; readonly reason: string }
  | {
      readonly kind: "run";
      /** The values to store first; null when what is stored is enough. */
      readonly save: PeerSlackSaveSecretsInput | null;
      readonly label: "Save and verify" | "Verify" | "Verify again";
    };

const SECRET_NAMES = { botToken: "bot token", signingSecret: "signing secret" } as const;

/**
 * Save and verify in one go for an app that exists: both values must be there, pasted now or stored
 * before. With nothing pasted, what is stored is verified again.
 */
export function slackVerifyPlan(
  admin: Pick<PeerSlackAdmin, "secrets" | "verifiedAt">,
  slug: string,
  values: { readonly botToken: string; readonly signingSecret: string },
): SlackVerifyPlan {
  const input = slackSecretsInput(slug, values);
  if (input.kind === "invalid") return { kind: "blocked", reason: input.message };
  const typed: {
    readonly botToken?: string | undefined;
    readonly signingSecret?: string | undefined;
  } = input.kind === "ready" ? input.input : {};
  const missing = (Object.keys(SECRET_NAMES) as Array<keyof typeof SECRET_NAMES>).filter(
    (name) => typed[name] === undefined && !stored(admin.secrets[name]),
  );
  if (missing.length > 0) {
    return {
      kind: "blocked",
      reason: `Paste the ${missing.map((name) => SECRET_NAMES[name]).join(" and the ")}.`,
    };
  }
  if (input.kind === "ready") return { kind: "run", save: input.input, label: "Save and verify" };
  return { kind: "run", save: null, label: admin.verifiedAt === null ? "Verify" : "Verify again" };
}

/**
 * What the step that stores the two values offers: Save both when both were pasted (or nothing yet),
 * Save when one is, since the Hub keeps the other as it is.
 */
export function slackSecretsLabel(values: {
  readonly botToken: string;
  readonly signingSecret: string;
}): "Save both" | "Save" {
  const typed = [values.botToken, values.signingSecret].filter((value) => value.trim() !== "");
  return typed.length === 1 ? "Save" : "Save both";
}
