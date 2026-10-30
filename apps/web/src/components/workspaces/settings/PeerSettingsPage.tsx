/**
 * The frame every page of the Peer settings area shares, and the small parts pages put in it: a
 * title with the person's role, notices that follow the person everywhere, and the lines that
 * say who changes a page or what is still to come.
 */
import {
  inactivePluginReason,
  pluginLockNote,
  type InactivePluginReason,
} from "@t3tools/client-runtime/peer/plugins";
import type { PeerHubStatus, PeerPluginId, PeerWorkspaceState } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { SettingsPageContainer } from "../../settings/settingsLayout";
import { WorkspacePageIntro } from "../../WorkspacePageIntro";
import { Alert, AlertDescription, AlertTitle } from "../../ui/alert";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { reasonText } from "../PeerPluginsSettings.logic";
import { AskAgentOfThisPage } from "./AskAgent";
import { useOptionalPeerSettings } from "./PeerSettingsContext";
import { useOpenPeerSettings } from "./peerSettingsLinks";
import type { RoleBadge } from "./peerSettings.logic";
import { ProposalsBanner } from "./Proposals";

/** What follows the person across the area: workspaces they lost, and a sync that failed. */
function PeerSettingsNotices() {
  const peer = useOptionalPeerSettings();
  if (peer === null) return null;
  const { status } = peer;
  const removed = status.removedFrom ?? [];
  if (removed.length === 0 && !status.error) return null;
  return (
    <div className="flex flex-col gap-2">
      {removed.map((workspace) => (
        <Alert key={workspace.slug} variant="warning">
          <AlertTitle>Workspace access removed</AlertTitle>
          <AlertDescription>
            An admin removed you from {workspace.name}. Ask an admin to invite you back.
          </AlertDescription>
        </Alert>
      ))}
      {status.error ? (
        <Alert variant="error">
          <AlertTitle>Last sync failed</AlertTitle>
          <AlertDescription>{status.error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

/** The scrolling page, with the notices above whatever the page shows. */
export function PeerSettingsFrame({ children }: { readonly children: ReactNode }) {
  return (
    <SettingsPageContainer>
      <PeerSettingsNotices />
      {children}
    </SettingsPageContainer>
  );
}

export function RoleBadgePill({ badge }: { readonly badge: RoleBadge }) {
  return (
    <Badge variant={badge.tone === "member" ? "secondary" : "info"} size="lg">
      {badge.label}
    </Badge>
  );
}

/**
 * A page with a title, as the design gives workspace pages: the name, the person's role, one line,
 * "Ask an agent" where the page has settings to change, and under them the proposals that wait for
 * what the page shows.
 */
export function PeerSettingsPage({
  title,
  description,
  mark,
  badge,
  askLast = false,
  children,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  /** Before the title: the workspace's mark on its General page. */
  readonly mark?: ReactNode;
  readonly badge?: RoleBadge | undefined;
  /** "Ask an agent" under the page, where its everyday actions come first. */
  readonly askLast?: boolean;
  readonly children?: ReactNode;
}) {
  return (
    <PeerSettingsFrame>
      <div className="flex flex-col gap-6">
        <WorkspacePageIntro
          title={title}
          description={description}
          leading={mark}
          meta={badge === undefined ? undefined : <RoleBadgePill badge={badge} />}
        />
        {askLast ? null : <AskAgentOfThisPage />}
      </div>
      <ProposalsBanner />
      {children}
      {askLast ? <AskAgentOfThisPage /> : null}
    </PeerSettingsFrame>
  );
}

/** What a page that is still being built says, and what it will hold. */
export function ComingInThisChange({ children }: { readonly children?: ReactNode }) {
  return (
    <p className="text-sm text-muted-foreground">
      Coming in this change{children === undefined ? "." : <>: {children}.</>}
    </p>
  );
}

/** Who to ask when a page holds what only a workspace's admins change. */
export function AdminOnlyNote({ workspace }: { readonly workspace: PeerWorkspaceState }) {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      Owners and admins of {workspace.name} change this. Ask one of them.
    </p>
  );
}

/** Why a plugin's page has nothing to show, and for a plugin turned off, where to turn it on. */
function PluginOffNote({
  title,
  text,
  reason,
  lockNote,
}: {
  readonly title: string;
  /** How the title continues to say why (`reasonText`). */
  readonly text: string;
  readonly reason: InactivePluginReason;
  readonly lockNote: string | null;
}) {
  const open = useOpenPeerSettings();
  return (
    <div className="flex flex-col items-start gap-3">
      <p role="status" className="text-sm text-muted-foreground">
        {lockNote ?? `${title} ${text}`}
      </p>
      {reason === "off" ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void open({ kind: "computer", section: "coordination" })}
        >
          Open Coordination & plugins
        </Button>
      ) : null}
    </div>
  );
}

/** The children while the plugin is active on the environment; else why it is not. */
export function RequirePlugin({
  status,
  plugin,
  title,
  children,
}: {
  readonly status: PeerHubStatus;
  readonly plugin: PeerPluginId;
  readonly title: string;
  readonly children: ReactNode;
}) {
  const reason = inactivePluginReason(status, plugin);
  if (reason === null) return children;
  const state = status.plugins?.find((candidate) => candidate.id === plugin);
  return (
    <PluginOffNote
      title={state?.title ?? title}
      text={reasonText(reason, status, plugin)}
      reason={reason}
      lockNote={state === undefined ? null : pluginLockNote(state)}
    />
  );
}
