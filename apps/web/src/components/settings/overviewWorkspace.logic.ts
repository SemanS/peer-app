/**
 * The Workspace and Me rows of Settings › Overview: the Hub, Slack, webhooks, GitHub's checks and
 * shared capacity that a workspace's admins connect, and the person's own Slack account and plans.
 * Each is told from facts the pages already read; a fact not read yet says "Checking…", and only
 * one that failed says "Problem".
 */
import {
  SLACK_OLDER_HUB_LINE,
  slackLinkView,
  slackOlderHub,
} from "@t3tools/client-runtime/peer/slack";
import { webhookStatus } from "@t3tools/client-runtime/peer/webhooks";
import type {
  PeerGitHubStatus,
  PeerHubStatus,
  PeerSettingsGatewayView,
  PeerSlackAdminResult,
  PeerSlackMe,
  PeerWebhookList,
  PeerWorkspaceRole,
} from "@t3tools/contracts";

import { hubAddress, hubBuild } from "../workspaces/settings/hubStatus.logic";
import { githubFactConnection } from "../workspaces/settings/integrations.logic";
import { formatLabel } from "../workspaces/settings/webhookForm.logic";
import { INTEGRATION_ANCHORS, isWorkspaceAdmin } from "../workspaces/settings/peerSettings.logic";
import {
  slackAdminConnection,
  slackMemberConnection,
} from "../workspaces/settings/slackConnection.logic";
import { CHECKING, LOADING, type ConnectionView, type Fact } from "./connectionFacts";
import {
  actionFor,
  overviewRow,
  pluginGate,
  type OverviewRow,
  type OverviewTarget,
} from "./overviewRow.logic";

/** The shared capacity gateway as the Overview reads it: its view, and the pools in the settings. */
export interface GatewayFact {
  readonly view: PeerSettingsGatewayView;
  /** How many model pools the workspace's settings define; null where they were not read. */
  readonly pools: number | null;
}

/** The plans a person added and the providers detected, which the AI subscriptions page tells. */
export type PlansFact =
  | { readonly kind: "loading" }
  /** The Hub does not show the settings, so the plans are not known. */
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "ready";
      /** The plans the person added, as "Claude Max". */
      readonly added: ReadonlyArray<string>;
      /** The plans the providers report that the person has not added. */
      readonly detected: number;
    };

/** What the Overview knows of the workspace the settings area has open. */
export interface WorkspaceFacts {
  readonly slug: string;
  readonly name: string;
  readonly role: PeerWorkspaceRole;
  /** The admin's view of Slack (admins only) and the member's own (everyone). */
  readonly slackAdmin: Fact<PeerSlackAdminResult> | null;
  readonly slackMe: Fact<PeerSlackMe> | null;
  readonly webhooks: Fact<PeerWebhookList> | null;
  readonly github: Fact<PeerGitHubStatus> | null;
  /** Null where the Hub cannot show the settings, so the gateway is not known. */
  readonly gateway: Fact<GatewayFact> | null;
  readonly plans: PlansFact;
}

export type PeerFacts = {
  readonly status: Pick<
    PeerHubStatus,
    "hubUrl" | "hub" | "signedIn" | "email" | "syncing" | "lastSyncAt" | "error" | "plugins"
  >;
  readonly workspace: WorkspaceFacts | null;
};

const peerTarget = (
  workspace: string,
  section: "hub" | "integrations" | "capacity" | "slack" | "plans",
  targetId?: string,
): OverviewTarget => ({
  kind: "peer",
  location: { kind: "workspace", workspace, section },
  ...(targetId === undefined ? {} : { targetId }),
});

const SLACK_UNTIL = "Until then agents ask only in Peer.";

/** The workspace's Slack as the person sees it: the admin's steps, or whether it is connected. */
export function workspaceSlackConnection(workspace: WorkspaceFacts): ConnectionView {
  return isWorkspaceAdmin(workspace.role)
    ? slackAdminConnection(workspace.slackAdmin ?? LOADING, workspace.name)
    : slackMemberConnection(workspace.slackMe ?? LOADING, workspace.name);
}

/** The Hub: connected as of the last sync, a problem when the last sync failed. */
function hubRow(peer: PeerFacts): OverviewRow {
  const { status, workspace } = peer;
  const build = hubBuild(status.hub);
  const version =
    build === null
      ? null
      : build.version !== null && build.commit !== null
        ? `${build.version} (${build.commit})`
        : (build.version ?? build.commit);
  const where = [hubAddress(status.hubUrl), version].filter((part) => part !== null).join(" · ");
  const connection: ConnectionView =
    status.error !== null
      ? { state: "problem", detail: `${where} · last sync failed: ${status.error}` }
      : status.lastSyncAt === null
        ? CHECKING
        : { state: "connected", detail: where, checkedAt: status.lastSyncAt };
  return overviewRow({
    id: "workspace:hub",
    group: "workspace",
    name: "Peer Hub",
    connection,
    action:
      workspace === null
        ? { label: "Join a workspace", target: { kind: "settings", to: "/settings/peer" } }
        : { label: "Hub", target: peerTarget(workspace.slug, "hub") },
  });
}

/** Slack's conversations, which an admin connects: the steps, or the problem Slack reports. */
function slackRow(peer: PeerFacts, workspace: WorkspaceFacts): OverviewRow | null {
  const gate = pluginGate(peer.status, "slack", "Slack");
  if (gate.kind === "hidden") return null;
  const connection = gate.kind === "view" ? gate.view : workspaceSlackConnection(workspace);
  return overviewRow({
    id: "workspace:slack",
    group: "workspace",
    name: "Slack conversations",
    subject: `Slack for ${workspace.name}`,
    connection,
    consequence: SLACK_UNTIL,
    action: actionFor(
      connection,
      peerTarget(workspace.slug, "integrations", INTEGRATION_ANCHORS.slack),
      "Integrations",
      { off: "Set up" },
    ),
  });
}

function pluralize(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "Slack and Teams", "Slack, Teams and Generic". */
function nameList(names: ReadonlyArray<string>): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * The webhooks: none yet is Off; one failing is a Problem; one that lacks its URL or signing key
 * Needs setup; otherwise Connected with how many deliver and where to.
 */
export function webhooksConnection(list: PeerWebhookList): ConnectionView {
  const hooks = list.webhooks;
  if (hooks.length === 0) {
    return {
      state: "off",
      detail: "No webhook yet: workspace events can go to Slack, Teams or your own address.",
    };
  }
  const states = hooks.map(webhookStatus);
  const failing = states.filter((state) => state === "failing").length;
  if (failing > 0) {
    return {
      state: "problem",
      detail: `${pluralize(failing, "webhook is", "webhooks are")} failing to deliver.`,
    };
  }
  const needSetup = states.filter((state) => state === "needs-setup").length;
  if (needSetup > 0) {
    return {
      state: "setup",
      detail: `${pluralize(needSetup, "webhook needs", "webhooks need")} its address or signing key.`,
      step: { n: 2, of: 2, title: "Add the address and signing key" },
    };
  }
  const delivering = hooks.filter((_, index) => states[index] !== "paused");
  if (delivering.length === 0) {
    return {
      state: "off",
      detail: `${pluralize(hooks.length, "webhook is", "webhooks are")} paused.`,
    };
  }
  const formats = [...new Set(delivering.map((hook) => formatLabel(hook.format)))];
  const paused = hooks.length - delivering.length;
  return {
    state: "connected",
    detail: `${delivering.length} delivering to ${nameList(formats)}${paused === 0 ? "" : ` · ${paused} paused`}`,
  };
}

function webhooksRow(peer: PeerFacts, workspace: WorkspaceFacts): OverviewRow | null {
  const gate = pluginGate(peer.status, "webhooks", "Webhooks");
  if (gate.kind === "hidden") return null;
  const fact = workspace.webhooks ?? LOADING;
  const connection =
    gate.kind === "view"
      ? gate.view
      : fact.kind === "loading"
        ? CHECKING
        : fact.kind === "failed"
          ? ({ state: "problem", detail: fact.message } satisfies ConnectionView)
          : webhooksConnection(fact.value);
  return overviewRow({
    id: "workspace:webhooks",
    group: "workspace",
    name: "Webhooks",
    subject: `Webhooks of ${workspace.name}`,
    connection,
    action: actionFor(
      connection,
      peerTarget(workspace.slug, "integrations", INTEGRATION_ANCHORS.webhooks),
      "Integrations",
      { off: "Add a webhook" },
    ),
  });
}

function githubRow(peer: PeerFacts, workspace: WorkspaceFacts): OverviewRow | null {
  const gate = pluginGate(peer.status, "github", "GitHub");
  if (gate.kind === "hidden") return null;
  const connection =
    gate.kind === "view" ? gate.view : githubFactConnection(workspace.github ?? LOADING);
  return overviewRow({
    id: "workspace:github",
    group: "workspace",
    name: "GitHub PR checks",
    subject: `GitHub PR checks for ${workspace.name}`,
    connection,
    consequence: "Until then pull requests count as their agents report them.",
    action: actionFor(
      connection,
      peerTarget(workspace.slug, "integrations", INTEGRATION_ANCHORS.github),
      "Integrations",
      { off: "Turn on" },
    ),
  });
}

/**
 * The gateway behind shared capacity: no address yet is Off; an address without the master key, or
 * one never synced, Needs setup; a failed sync is a Problem; a synced gateway is Connected, as of
 * the sync, with the pools it holds.
 */
export function gatewayConnection(gateway: GatewayFact): ConnectionView {
  const { view, pools } = gateway;
  if (!view.configured) {
    return { state: "off", detail: "No gateway yet: projects cannot draw on shared API capacity." };
  }
  if (!view.masterKey.stored)
    return {
      state: "setup",
      detail: "Store the gateway’s master key.",
      step: { n: 2, of: 3, title: "Store the master key" },
    };
  const sync = view.sync;
  if (sync === undefined || sync === null)
    return {
      state: "setup",
      detail: "Sync the gateway.",
      step: { n: 3, of: 3, title: "Sync the gateway" },
    };
  if (!sync.ok) {
    return {
      state: "problem",
      detail: `The last sync with the gateway failed${sync.error === undefined ? "." : `: ${sync.error}`}`,
    };
  }
  return {
    state: "connected",
    detail:
      pools === null
        ? "Gateway synced"
        : `Gateway synced · ${pluralize(pools, "model pool", "model pools")}`,
    checkedAt: sync.at,
  };
}

function capacityRow(peer: PeerFacts, workspace: WorkspaceFacts): OverviewRow | null {
  const gate = pluginGate(peer.status, "capacity", "Shared capacity");
  if (gate.kind === "hidden") return null;
  const fact = workspace.gateway;
  const connection =
    gate.kind === "view"
      ? gate.view
      : fact === null
        ? ({
            state: "unavailable",
            detail: "This Peer Hub cannot show the gateway here yet.",
          } satisfies ConnectionView)
        : fact.kind === "loading"
          ? CHECKING
          : fact.kind === "failed"
            ? ({ state: "problem", detail: fact.message } satisfies ConnectionView)
            : gatewayConnection(fact.value);
  return overviewRow({
    id: "workspace:capacity",
    group: "workspace",
    name: "Shared capacity",
    subject: `Shared capacity of ${workspace.name}`,
    connection,
    action: actionFor(connection, peerTarget(workspace.slug, "capacity"), "Shared capacity", {
      off: "Set up",
    }),
  });
}

/** The Workspace group: the Hub for everyone, the rest for the admins who connect them. */
export function workspaceRows(peer: PeerFacts): ReadonlyArray<OverviewRow> {
  const { workspace } = peer;
  const rows: Array<OverviewRow | null> = [hubRow(peer)];
  if (workspace !== null && isWorkspaceAdmin(workspace.role)) {
    rows.push(
      slackRow(peer, workspace),
      webhooksRow(peer, workspace),
      githubRow(peer, workspace),
      capacityRow(peer, workspace),
    );
  }
  return rows.filter((row): row is OverviewRow => row !== null);
}

/**
 * The person's own Slack account: waiting while the workspace has not connected Slack, then not
 * linked, a link waiting for its proof, or linked (with whether their agents' questions go there).
 */
export function slackAccountConnection(fact: Fact<PeerSlackMe>): ConnectionView {
  if (fact.kind === "loading") return CHECKING;
  if (fact.kind === "failed") {
    return slackOlderHub(fact.message)
      ? { state: "unavailable", detail: SLACK_OLDER_HUB_LINE }
      : { state: "problem", detail: fact.message };
  }
  const me = fact.value;
  if (!me.connected) {
    return { state: "off", label: "Waiting", detail: "For the workspace to connect Slack." };
  }
  const link = slackLinkView(me);
  if (link.kind === "pending") return { state: "setup", detail: link.text };
  if (link.kind === "none") {
    return {
      state: "setup",
      detail: "Link your Slack account to get your agents’ questions there.",
    };
  }
  return {
    state: "connected",
    detail: me.settings.enabled
      ? `${link.text}. Your agents ask you in Slack.`
      : `${link.text}. Your agents’ questions stay in Peer until you turn Slack on.`,
  };
}

function slackAccountRow(peer: PeerFacts, workspace: WorkspaceFacts): OverviewRow | null {
  const gate = pluginGate(peer.status, "slack", "Slack");
  if (gate.kind === "hidden") return null;
  const connection =
    gate.kind === "view" ? gate.view : slackAccountConnection(workspace.slackMe ?? LOADING);
  return overviewRow({
    id: "me:slack",
    group: "me",
    name: "Slack account",
    subject: "Your Slack account",
    connection,
    action: actionFor(connection, peerTarget(workspace.slug, "slack"), "Me › Slack"),
  });
}

const planCount = (count: number) => `${count} ${count === 1 ? "plan" : "plans"}`;

/**
 * The person's AI plans: some detected on this computer and not added Needs setup (the person
 * decides, one click each); added ones are Added; none at all is Off.
 */
export function plansConnection(plans: PlansFact): ConnectionView {
  if (plans.kind === "loading") return CHECKING;
  if (plans.kind === "unavailable") {
    return { state: "unavailable", detail: "This Peer Hub does not show your plans yet." };
  }
  if (plans.detected > 0) {
    return {
      state: "setup",
      detail: `${planCount(plans.detected)} detected on this computer, ${plans.added.length === 0 ? "none added" : `${plans.added.length} added`}.`,
    };
  }
  if (plans.added.length > 0) {
    return { state: "connected", label: "Added", detail: plans.added.join(", ") };
  }
  return { state: "off", detail: "No plan added yet." };
}

function plansRow(workspace: WorkspaceFacts): OverviewRow {
  const connection = plansConnection(workspace.plans);
  const { plans } = workspace;
  return overviewRow({
    id: "me:plans",
    group: "me",
    name: "AI subscriptions",
    subject: "Your AI subscriptions",
    connection,
    ...(plans.kind === "ready" && plans.detected > 0
      ? { badge: `${plans.detected} detected` }
      : {}),
    action:
      connection.state === "setup"
        ? { label: "Review", target: peerTarget(workspace.slug, "plans") }
        : actionFor(connection, peerTarget(workspace.slug, "plans"), "AI subscriptions", {
            off: "Add a plan",
          }),
  });
}

/** The Me group: the person's Slack account and AI plans in the workspace that is open. */
export function meRows(peer: PeerFacts): ReadonlyArray<OverviewRow> {
  const { workspace } = peer;
  if (workspace === null) return [];
  return [slackAccountRow(peer, workspace), plansRow(workspace)].filter(
    (row): row is OverviewRow => row !== null,
  );
}
