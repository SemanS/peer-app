/**
 * The Slack plugin's row on This computer › Coordination & plugins (design artboard 4d). The plugin
 * works on this computer, but nothing is asked in Slack until a workspace has connected it, so the
 * row says Waiting, for that workspace, with the way to connect it; once connected it points to
 * Me › Slack. One line per workspace the computer is in; each reads that workspace's Slack once.
 */
import type { EnvironmentId, PeerHubStatus, PeerWorkspaceState } from "@t3tools/contracts";

import { useEnvironmentQuery } from "../../../state/query";
import { ConnectionBadge } from "../../settings/ConnectionStatus";
import { InlineButton } from "../../ui/button";
import { slackAtoms } from "../slack/atoms";
import { slackPluginLine } from "./coordinationAndPlugins.logic";
import { useOpenPeerSettings } from "./peerSettingsLinks";

interface LineProps {
  readonly environmentId: EnvironmentId;
  readonly workspace: PeerWorkspaceState;
  readonly owner: boolean;
  readonly named: boolean;
}

/** What one workspace's line says; every part of the row reads the same query, so it is read once. */
function useSlackLine({ environmentId, workspace, owner, named }: LineProps) {
  const me = useEnvironmentQuery(
    slackAtoms.me({ environmentId, input: { workspace: workspace.slug } }),
  );
  return slackPluginLine({
    workspace,
    connected: me.data === null ? null : me.data.connected,
    error: me.error,
    owner,
    named,
  });
}

function SlackChip(props: LineProps) {
  const line = useSlackLine(props);
  return (
    <span className="inline-flex items-center gap-2">
      <ConnectionBadge state={line.status} label={line.statusLabel} />
      {line.source === "" ? null : (
        <span className="text-xs text-muted-foreground">{line.source}</span>
      )}
    </span>
  );
}

function SlackNote(props: LineProps) {
  const line = useSlackLine(props);
  const open = useOpenPeerSettings();
  if (line.note === null) return null;
  const { link } = line;
  return (
    <span className="flex flex-col items-start gap-0.5 text-xs">
      <span className="text-muted-foreground">{line.note}</span>
      {link === null ? null : (
        <InlineButton
          onClick={() =>
            void open({ kind: "workspace", workspace: props.workspace.slug, section: link.section })
          }
        >
          {link.label}
        </InlineButton>
      )}
    </span>
  );
}

/** The chips at the end of the row, one per workspace. */
export function SlackPluginChips({
  environmentId,
  status,
  owner,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly owner: boolean;
}) {
  const named = status.workspaces.length > 1;
  return (
    <span className="flex flex-col items-start gap-1">
      {status.workspaces.map((workspace) => (
        <SlackChip
          key={workspace.slug}
          environmentId={environmentId}
          workspace={workspace}
          owner={owner}
          named={named}
        />
      ))}
    </span>
  );
}

/** What the row says under its name, one note and link per workspace. */
export function SlackPluginNotes({
  environmentId,
  status,
  owner,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly owner: boolean;
}) {
  const named = status.workspaces.length > 1;
  return status.workspaces.map((workspace) => (
    <SlackNote
      key={workspace.slug}
      environmentId={environmentId}
      workspace={workspace}
      owner={owner}
      named={named}
    />
  ));
}
