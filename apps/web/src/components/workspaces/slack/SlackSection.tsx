import type { PeerSlotProps } from "../slots.types";
import { SlackMePage } from "./SlackMePage";

/**
 * Slack in the plugin’s `settings` slot: every member’s own account and options, one block per
 * workspace. Settings renders the same page under Me › Slack with the workspace’s admins named; an
 * admin connects Slack under Workspace › Integrations.
 */
export function SlackSection({ environmentId, status }: PeerSlotProps) {
  return status.workspaces.map((workspace) => (
    <SlackMePage
      key={workspace.slug}
      environmentId={environmentId}
      workspace={workspace}
      admins={[]}
    />
  ));
}
