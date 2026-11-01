/**
 * The Workspace rows of Settings › Overview: the Hub and GitHub's checks that a workspace's admins
 * connect. Each is told from facts the pages already read; a fact not read yet says "Checking…", and only
 * one that failed says "Problem".
 */
import type { PeerGitHubStatus, PeerHubStatus, PeerWorkspaceRole } from "@t3tools/contracts";

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

/** What the Overview knows of the workspace the settings area has open. */
export interface WorkspaceFacts {
  readonly slug: string;
  readonly name: string;
  readonly role: PeerWorkspaceRole;
  readonly github: Fact<PeerGitHubStatus> | null;
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
  section: "hub" | "general",
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

/** The Workspace group: the Hub for everyone, the rest for the admins who connect them. */
export function workspaceRows(peer: PeerFacts): ReadonlyArray<OverviewRow> {
  const { workspace } = peer;
  const rows: Array<OverviewRow | null> = [hubRow(peer)];
  if (workspace !== null && isWorkspaceAdmin(workspace.role)) {
    rows.push(githubRow(peer, workspace));
  }
  return rows.filter((row): row is OverviewRow => row !== null);
}
