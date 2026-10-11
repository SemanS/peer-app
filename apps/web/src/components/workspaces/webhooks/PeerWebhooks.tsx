import { useState } from "react";
import { administeredWorkspaces } from "@t3tools/client-runtime/peer/webhooks";
import type { PeerSlotProps } from "../slots.types";
import { SettingsRow } from "../../settings/settingsLayout";
import { Button } from "../../ui/button";
import { useEnvironmentQuery } from "../../../state/query";
import { webhookAtoms } from "./atoms";
import { WebhookRow } from "./WebhookRow";
import { webhooksView } from "./webhooks.logic";

export function PeerWebhooks({ environmentId, status }: PeerSlotProps) {
  return administeredWorkspaces(status).map((workspace) => (
    <WorkspaceWebhooks key={workspace.slug} environmentId={environmentId} workspace={workspace} />
  ));
}

/** One administered workspace's webhooks; Settings shows it under that workspace's Integrations. */
export function WorkspaceWebhooks({
  environmentId,
  workspace,
}: {
  readonly environmentId: PeerSlotProps["environmentId"];
  readonly workspace: PeerSlotProps["status"]["workspaces"][number];
}) {
  const [open, setOpen] = useState(false);
  const query = useEnvironmentQuery(
    open ? webhookAtoms.list({ environmentId, input: { workspace: workspace.slug } }) : null,
  );
  const view = webhooksView(workspace.role, query);
  return (
    <SettingsRow
      title={`Webhooks · ${workspace.name}`}
      description="Delivery health and retries. Destinations are configured by your Hub administrator."
      control={
        <Button variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Hide webhooks" : "Show webhooks"}
        </Button>
      }
    >
      {open && view ? (
        <div className="flex flex-col gap-3 pt-2 pb-3">
          <Button
            className="self-start"
            variant="outline"
            size="xs"
            disabled={query.isPending}
            onClick={query.refresh}
          >
            Refresh
          </Button>
          {view.kind === "loading" ? (
            <p role="status" className="text-xs text-muted-foreground">
              Loading webhooks…
            </p>
          ) : null}
          {view.kind === "error" ? (
            <p role="alert" className="text-xs text-destructive">
              {view.message}
            </p>
          ) : null}
          {view.kind === "empty" ? (
            <p className="text-xs text-muted-foreground">
              No webhooks. Ask your Hub administrator to configure a destination.
            </p>
          ) : null}
          {view.kind === "ready"
            ? view.rows.map((webhook) => (
                <WebhookRow
                  key={webhook.id}
                  environmentId={environmentId}
                  workspace={workspace.slug}
                  webhook={webhook}
                  onRefresh={query.refresh}
                />
              ))
            : null}
        </div>
      ) : null}
    </SettingsRow>
  );
}
