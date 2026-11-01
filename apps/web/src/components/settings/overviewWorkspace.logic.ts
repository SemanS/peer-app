/**
 * The Workspace and Me rows of Settings › Overview: the Hub, GitHub's checks and shared capacity
 * that a workspace's admins connect, and the person's own plans.
 * Each is told from facts the pages already read; a fact not read yet says "Checking…", and only
 * one that failed says "Problem".
 */
import type {
  PeerGitHubStatus,
  PeerHubStatus,
  PeerSettingsGatewayView,
  PeerWorkspaceRole,
} from "@t3tools/contracts";

import { hubAddress, hubBuild } from "../workspaces/settings/hubStatus.logic";
import { githubFactConnection } from "../workspaces/settings/integrations.logic";
import { GITHUB_ANCHOR, isWorkspaceAdmin } from "../workspaces/settings/peerSettings.logic";
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
  section: "hub" | "general" | "capacity" | "plans",
  targetId?: string,
): OverviewTarget => ({
  kind: "peer",
  location: { kind: "workspace", workspace, section },
  ...(targetId === undefined ? {} : { targetId }),
});

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

function pluralize(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
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
    action: actionFor(connection, peerTarget(workspace.slug, "general", GITHUB_ANCHOR), "GitHub", {
      off: "Turn on",
    }),
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
    rows.push(githubRow(peer, workspace), capacityRow(peer, workspace));
  }
  return rows.filter((row): row is OverviewRow => row !== null);
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

/** The Me group: the person's AI plans in the workspace that is open. */
export function meRows(peer: PeerFacts): ReadonlyArray<OverviewRow> {
  const { workspace } = peer;
  return workspace === null ? [] : [plansRow(workspace)];
}
