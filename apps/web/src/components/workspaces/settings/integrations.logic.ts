/**
 * What the Integrations page's three cards say (design artboard 19), apart from how they draw: the
 * GitHub PR checks card from GitHub's status, the Slack card from the admin's view of the
 * connection, and the webhook rows from the webhooks the settings document holds together with what
 * the webhooks plugin knows of their deliveries.
 */
import { slackOlderHub, slackSetupStep } from "@t3tools/client-runtime/peer/slack";
import { canRequeue, orderWebhooks, webhookStatus } from "@t3tools/client-runtime/peer/webhooks";
import type {
  PeerGitHubStatus,
  PeerSlackAdminResult,
  PeerWebhook,
  PeerWebhookList,
} from "@t3tools/contracts";

import {
  slackOlderHubStatus,
  slackReadingStatus,
  slackStatus,
  slackUnreadableStatus,
  type SlackStatus,
  type SlackStatusHints,
} from "../slack/slack.logic";
import { CHECKING, type ConnectionView, type Fact } from "../../settings/connectionFacts";
import type { ConnectionState } from "../../settings/connectionStatus.logic";
import { formatLabel, titleOfId, type SavedHook } from "./webhookForm.logic";

// ---- GitHub PR checks -------------------------------------------------------------------------------

/** What the checks do, in the wording of design A6: it promises no more than the Hub does. */
export const GITHUB_DESCRIPTION =
  "When GitHub reports a pull request, its word counts over the agent’s report.";

const GITHUB_OFF_DESCRIPTION =
  "Off: pull requests count as their agents report them. Set it up and GitHub’s word counts over the agent’s report.";

const GITHUB_UNSUPPORTED = "This Hub does not verify pull requests with GitHub.";

const GITHUB_SECRET_CAUSE = "Its secret is not stored, so GitHub’s deliveries are refused.";

/** What turning the checks off says before the review of it. */
export const TURN_OFF_TEXT =
  "Turning off deletes the merges GitHub confirmed. Tasks keep the PRs their agents reported.";

export interface GitHubCardView {
  /** The checks in the status language: the badge, its step or detail, and when GitHub last pinged. */
  readonly connection: ConnectionView;
  readonly description: string;
  readonly canSetUp: boolean;
  /** The wizard's button: "Set up", "Continue setup", "Fix" or "Manage" by where the checks stand. */
  readonly setupLabel: string;
  readonly canTurnOff: boolean;
  /** The checks are on and the secret is not stored: GitHub's deliveries are refused. */
  readonly secretMissing: boolean;
}

/** The repositories on github.com that the checks cover, each once. */
export function coveredRepositories(status: Pick<PeerGitHubStatus, "repositories">): number {
  return new Set(
    status.repositories.flatMap((repository) =>
      repository.github === null ? [] : [repository.github.toLowerCase()],
    ),
  ).size;
}

/**
 * The checks in the status language, from what the Hub reports. Off before they are set up; Needs
 * setup, at the wizard's step, until GitHub's first ping arrives; Connected from then on, as of the
 * last ping; a Problem when GitHub pinged before and the secret that signs its deliveries is gone.
 */
export function githubConnection(status: PeerGitHubStatus): ConnectionView {
  if (status.unsupported === true) return { state: "unavailable", detail: GITHUB_UNSUPPORTED };
  if (!status.configured) return { state: "off", detail: "Agents can’t prove a merge yet." };
  const pinged = status.lastPingAt !== null;
  if (status.secret === "missing" && pinged) {
    return { state: "problem", detail: GITHUB_SECRET_CAUSE };
  }
  if (!pinged) {
    return {
      state: "setup",
      step: { n: 2, of: 3, title: "add the webhook in GitHub, then wait for its ping" },
    };
  }
  const covered = coveredRepositories(status);
  return {
    state: "connected",
    detail: `${covered} ${covered === 1 ? "repository" : "repositories"}`,
    checkedAt: status.lastPingAt ?? undefined,
  };
}

/** The checks' connection while their status is read, failed or here. */
export function githubFactConnection(fact: Fact<PeerGitHubStatus>): ConnectionView {
  if (fact.kind === "loading") return CHECKING;
  if (fact.kind === "failed") return { state: "problem", detail: fact.message };
  return githubConnection(fact.value);
}

const GITHUB_SETUP_LABEL: Readonly<Record<ConnectionState, string>> = {
  unavailable: "",
  off: "Set up",
  setup: "Continue setup",
  connected: "Manage",
  problem: "Fix",
};

export function githubCardView(status: PeerGitHubStatus): GitHubCardView {
  const connection = githubConnection(status);
  if (status.unsupported === true) {
    return {
      connection,
      description: GITHUB_UNSUPPORTED,
      canSetUp: false,
      setupLabel: GITHUB_SETUP_LABEL.unavailable,
      canTurnOff: false,
      secretMissing: false,
    };
  }
  return {
    connection,
    description: status.configured ? GITHUB_DESCRIPTION : GITHUB_OFF_DESCRIPTION,
    canSetUp: true,
    setupLabel: GITHUB_SETUP_LABEL[connection.state],
    canTurnOff: status.configured,
    secretMissing: status.configured && status.secret === "missing",
  };
}

export const GITHUB_SECRET_MISSING = `${GITHUB_SECRET_CAUSE} Make a new one in the setup.`;

// ---- Slack ---------------------------------------------------------------------------------------------

/** A member of the workspace who linked their Slack account. */
export interface LinkedMemberRow {
  readonly email: string;
  readonly name: string;
  /** Their Slack name, `@slavo`. */
  readonly handle: string;
  readonly you: boolean;
}

export type SlackCardState =
  | { readonly kind: "loading" }
  | { readonly kind: "older-hub" }
  | { readonly kind: "error"; readonly message: string }
  /** Not connected yet: the admin's setup leads through it. */
  | { readonly kind: "setup"; readonly admin: PeerSlackAdminResult }
  | {
      readonly kind: "connected";
      readonly admin: PeerSlackAdminResult;
      readonly team: string;
      readonly linked: number;
      /** Who linked, when the Hub lists them; empty while it does not. */
      readonly members: ReadonlyArray<LinkedMemberRow>;
    };

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function slackCardState(
  query: { readonly data: PeerSlackAdminResult | null; readonly error: string | null },
  me: string | null,
): SlackCardState {
  if (query.error !== null) {
    return slackOlderHub(query.error)
      ? { kind: "older-hub" }
      : { kind: "error", message: query.error };
  }
  const admin = query.data;
  if (admin === null) return { kind: "loading" };
  // Connected means the whole setup is done, down to a place for agents to post; before that the
  // setup is what the admin needs, not a list of members.
  if (slackSetupStep(admin).step !== "connected") return { kind: "setup", admin };
  const members = (admin.members ?? [])
    .map((member) => ({
      email: member.email,
      name: member.name === "" ? member.email : member.name,
      handle: member.link.name === "" ? member.email : `@${member.link.name.replace(/^@/, "")}`,
      you: me !== null && sameAddress(member.email, me),
    }))
    .toSorted((a, b) => Number(b.you) - Number(a.you) || a.name.localeCompare(b.name));
  return {
    kind: "connected",
    admin,
    team: admin.team?.name ?? "Slack",
    linked: admin.linkedMembers,
    members,
  };
}

/**
 * The card's status line, in the one language every connection speaks: Needs setup with the step it
 * is at (also while the values are saved and not verified, which the Hub calls off), Problem,
 * Connected to the Slack workspace, or Not available on a Hub without Slack.
 */
export function slackCardStatus(state: SlackCardState, hints: SlackStatusHints = {}): SlackStatus {
  switch (state.kind) {
    case "loading":
      return slackReadingStatus;
    case "older-hub":
      return slackOlderHubStatus;
    case "error":
      return slackUnreadableStatus(state.message);
    case "setup":
    case "connected":
      return slackStatus(state.admin, hints);
  }
}

/** What the card says of who linked, when the Hub does not list them. */
export const linkedText = (linked: number): string =>
  linked === 0
    ? "No one has linked a Slack account yet."
    : `${linked} ${linked === 1 ? "member has" : "members have"} linked a Slack account.`;

/** What disconnecting a member tells the admin. */
export const memberDisconnected = (name: string): string =>
  `${name} is disconnected. Their agent threads in Slack stop; they can link again in Me › Slack.`;

// ---- webhooks --------------------------------------------------------------------------------------------

export interface WebhookRowView {
  readonly id: string;
  readonly title: string;
  /** "Generic · signed · 3 events · Booking, Peer Hub". */
  readonly meta: string;
  readonly status: { readonly text: string; readonly tone: "ok" | "warn" | "quiet" };
  /** The failed deliveries Requeue sends again; 0 where there is nothing to send again. */
  readonly requeue: number;
  /** What the webhooks plugin knows of it: deliveries, health. */
  readonly entry: PeerWebhook | null;
  /** The settings document holds it, so it can be edited here. */
  readonly editable: boolean;
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** Why a webhook that needs setup is off, in the design's words. */
function needsSetup(entry: PeerWebhook): string {
  if (entry.destination.state === "missing") return "Off · its URL secret is missing";
  if (entry.destination.state !== "ok") return "Off · its URL secret is not an https address";
  // The Hub says `missing` for a signing secret that is not stored and for one that is not a `whsec_` key.
  if (entry.signing === "missing") return "Off · its signing secret is missing or not a whsec_ key";
  return "Off · it needs setup";
}

/** "1 attempt", "3 attempts": how many times a delivery was tried. */
export const attemptsText = (count: number): string =>
  `${count} ${plural(count, "attempt", "attempts")}`;

export function webhookStatusOf(entry: PeerWebhook): WebhookRowView["status"] {
  switch (webhookStatus(entry)) {
    case "paused":
      return { text: "Paused", tone: "quiet" };
    case "needs-setup":
      return { text: needsSetup(entry), tone: "warn" };
    case "failing": {
      const failed = entry.health.failed;
      return { text: `${failed} failed ${plural(failed, "delivery", "deliveries")}`, tone: "warn" };
    }
    case "retrying":
      return { text: "Retrying", tone: "warn" };
    case "healthy":
      return { text: "Delivering", tone: "ok" };
  }
}

/**
 * The webhooks as rows. A webhook is on the list when the settings document has it or the plugin
 * lists it (a Hub older than the settings has only the plugin's list, which can be read and
 * requeued but not edited here). Those the plugin lists come first, the ones that need attention
 * first among them; then those it has not applied yet.
 */
export function webhookRows(input: {
  readonly saved: ReadonlyMap<string, SavedHook>;
  /** What the webhooks plugin lists; null until it has been read. */
  readonly list: PeerWebhookList | null;
  readonly listFailed: boolean;
  readonly workspaceName: string;
  readonly projectName: (id: string) => string;
}): ReadonlyArray<WebhookRowView> {
  const entries = new Map((input.list?.webhooks ?? []).map((entry) => [entry.id, entry] as const));
  const ordered = orderWebhooks([...entries.values()]).map((entry) => entry.id);
  const pending = [...input.saved.keys()]
    .filter((id) => !entries.has(id))
    .toSorted((a, b) => a.localeCompare(b));
  return [...ordered, ...pending].map((id) => {
    const entry = entries.get(id) ?? null;
    const saved = input.saved.get(id) ?? null;
    const format = entry?.format ?? saved?.format ?? "";
    const events = entry?.events ?? saved?.events ?? [];
    const projects = entry === null ? (saved?.projects ?? null) : entry.projects;
    const signed =
      entry === null ? (saved?.signingSecret.length ?? 0) > 0 : entry.signing !== "derived";
    const where =
      projects === null
        ? `projects open to all of ${input.workspaceName}`
        : projects.map(input.projectName).join(", ");
    return {
      id,
      title: titleOfId(id),
      meta: [
        formatLabel(format),
        ...(signed ? ["signed"] : []),
        `${events.length} ${plural(events.length, "event", "events")}`,
        where,
      ].join(" · "),
      status:
        entry !== null
          ? webhookStatusOf(entry)
          : {
              text: input.listFailed
                ? "Status unknown"
                : input.list === null
                  ? "Checking…"
                  : "Saved · not applied yet",
              tone: "quiet" as const,
            },
      requeue: entry !== null && canRequeue(entry) ? entry.health.failed : 0,
      entry,
      editable: saved !== null,
    };
  });
}

/**
 * What the card says while it has no webhook to list: that it is reading them, how to add one, or,
 * against a Hub that cannot change them here, how to add them with files.
 */
export function webhooksEmptyText(input: {
  readonly loading: boolean;
  readonly hubHasSettings: boolean;
  /** The settings were read and can be changed from here. */
  readonly editable: boolean;
}): string {
  if (input.loading) return "Loading webhooks…";
  if (input.editable) {
    return "No webhooks yet. Add one to send workspace events to Slack, Teams or an address of your own.";
  }
  return input.hubHasSettings
    ? "No webhooks."
    : "No webhooks yet. Add them as files in the workspace directory (webhooks/<id>.yaml), store each address as a secret, and run peerhub workspace apply.";
}

/** "3 of 20": how many webhooks the workspace has. */
export const webhookCountText = (count: number, max: number): string => `${count} of ${max}`;
