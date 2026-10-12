import type { EnvironmentId, PeerWorkspaceState } from "@t3tools/contracts";
import { SLACK_OLDER_HUB_LINE, isSlackAdmin } from "@t3tools/client-runtime/peer/slack";
import { useState } from "react";

import { SettingsRow } from "../../settings/settingsLayout";
import { Button } from "../../ui/button";
import { useEnvironmentQuery } from "../../../state/query";
import type { PeerSlotProps } from "../slots.types";
import { slackAtoms } from "./atoms";
import { SlackRow } from "./SlackRow";
import { SlackMember } from "./SlackMember";
import { slackSectionView, type SlackSectionView } from "./slack.logic";

/**
 * Slack, one block per workspace: every member’s own link and options. (An admin connects Slack under
 * Workspace › Integrations.) A block reads from the Hub when it is opened and again after each
 * action; nothing refreshes on a timer.
 */
export function SlackSection({ environmentId, status }: PeerSlotProps) {
  return status.workspaces.map((workspace) => (
    <WorkspaceSlack key={workspace.slug} environmentId={environmentId} workspace={workspace} />
  ));
}

/** One workspace's Slack block: the person's own options, as Settings shows them under Me. */
export function WorkspaceSlack({
  environmentId,
  workspace,
  defaultOpen = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: PeerWorkspaceState;
  /** Reads and shows the block at once, for a page that holds nothing else. */
  readonly defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const input = { workspace: workspace.slug };
  const me = useEnvironmentQuery(open ? slackAtoms.me({ environmentId, input }) : null);
  const connection = useEnvironmentQuery(
    open && isSlackAdmin(workspace.role) ? slackAtoms.admin({ environmentId, input }) : null,
  );
  const view = slackSectionView(workspace.role, { me, admin: connection });
  const refresh = () => {
    me.refresh();
    connection.refresh();
  };
  return (
    <>
      <SettingsRow
        title={`Slack · ${workspace.name}`}
        description="Your agents ask you in Slack when they wait, and your replies go back to them."
        control={
          <div className="flex items-center gap-2">
            {open ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={me.isPending || connection.isPending}
                onClick={refresh}
              >
                Refresh
              </Button>
            ) : null}
            <Button variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? "Hide Slack" : "Show Slack"}
            </Button>
          </div>
        }
      >
        {open && view.kind !== "ready" ? <SlackState view={view} onRetry={refresh} /> : null}
      </SettingsRow>
      {open && view.kind === "ready" ? (
        view.member === null ? (
          <SlackRow
            title="Slack is not connected yet"
            description="Connect it under Workspace › Integrations; your own options appear here once it is."
          />
        ) : (
          <SlackMember
            environmentId={environmentId}
            workspace={workspace.slug}
            part={view.member}
            refresh={refresh}
          />
        )
      ) : null}
    </>
  );
}

/** What a block says while it has nothing to show: it loads, the Hub has no Slack, or it failed. */
function SlackState({
  view,
  onRetry,
}: {
  readonly view: Exclude<SlackSectionView, { readonly kind: "ready" }>;
  readonly onRetry: () => void;
}) {
  switch (view.kind) {
    case "loading":
      return (
        <p role="status" className="pb-2 text-sm text-muted-foreground">
          Loading Slack…
        </p>
      );
    case "older-hub":
      return <p className="pb-2 text-sm text-muted-foreground">{SLACK_OLDER_HUB_LINE}</p>;
    case "error":
      return (
        <div className="flex flex-wrap items-center gap-2 pb-2">
          <p role="alert" className="text-sm text-destructive">
            {view.message}
          </p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      );
  }
}
