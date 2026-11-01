/**
 * The Workspace row of Settings › Overview: the Hub, told from what the status already says.
 */
import type { PeerHubStatus, PeerWorkspaceRole } from "@t3tools/contracts";

import { hubAddress, hubBuild } from "../workspaces/settings/hubStatus.logic";
import { CHECKING, type ConnectionView } from "./connectionFacts";
import { overviewRow, type OverviewRow, type OverviewTarget } from "./overviewRow.logic";

/** What the Overview knows of the workspace the settings area has open. */
export interface WorkspaceFacts {
  readonly slug: string;
  readonly name: string;
  readonly role: PeerWorkspaceRole;
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

/** The Workspace group: the Hub, for everyone. */
export function workspaceRows(peer: PeerFacts): ReadonlyArray<OverviewRow> {
  return [hubRow(peer)];
}
