import type { EnvironmentId, PeerHubStatus, PeerWorkspaceState } from "@t3tools/contracts";
import { useState } from "react";

import { useEnvironmentQuery } from "../../../../state/query";
import { serverEnvironment } from "../../../../state/server";
import { InlineButton } from "../../../ui/button";
import type { WorkspacePageProps } from "../pageProps";
import { isWorkspaceAdmin } from "../peerSettings.logic";
import { useOpenPeerSettings } from "../peerSettingsLinks";
import { AdminOnlyNote, PeerSettingsPage } from "../PeerSettingsPage";
import { SECRETS_DESCRIPTION, secretRows, type SecretRow } from "../secrets.logic";
import { DeleteSecretDialog, SecretValueDialog, SecretsTable } from "../SecretsParts";
import { SettingsUnavailableNote } from "../SettingsUnavailable";
import { useSettingsView } from "../useSettingsView";

/**
 * The workspace's secrets (design artboard 18): names and what uses them, where each value stands,
 * and storing, replacing or deleting one. Admins only; the Hub seals every value and never shows
 * one again. Against a Hub without the settings feature there is no list to read.
 */
export function Secrets({ environmentId, status, workspace }: WorkspacePageProps) {
  return (
    <PeerSettingsPage title="Secrets" description={SECRETS_DESCRIPTION}>
      {isWorkspaceAdmin(workspace.role) ? (
        <SecretsOfAdmin environmentId={environmentId} status={status} workspace={workspace} />
      ) : (
        <AdminOnlyNote workspace={workspace} />
      )}
    </PeerSettingsPage>
  );
}

function SecretsOfAdmin({
  environmentId,
  status,
  workspace,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly workspace: PeerWorkspaceState;
}) {
  const view = useSettingsView(workspace.slug);
  const open = useOpenPeerSettings();
  const person = status.email;
  const query = useEnvironmentQuery(
    view.hubHasSettings && person !== null
      ? serverEnvironment.peerSettings.secrets({
          environmentId,
          person,
          input: { workspace: workspace.slug },
        })
      : null,
  );
  const [setting, setSetting] = useState<SecretRow | null>(null);
  const [deleting, setDeleting] = useState<SecretRow | null>(null);

  const rows =
    query.data === null
      ? null
      : secretRows(query.data, { nameOf: (person) => view.nameOf(person) });

  return (
    <>
      <SettingsUnavailableNote />
      {query.error === null ? null : (
        <p role="alert" className="text-sm text-destructive-foreground">
          Could not read the secrets: {query.error}{" "}
          <InlineButton tone="muted" onClick={query.refresh}>
            Try again
          </InlineButton>
        </p>
      )}
      {view.hubHasSettings && rows === null && query.error === null ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading secrets…
        </p>
      ) : null}
      {rows === null ? null : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No secrets yet. A webhook’s address, GitHub PR checks and the gateway’s key each store
          theirs when you set them up.
        </p>
      ) : (
        <SecretsTable rows={rows} onSet={setSetting} onDelete={setDeleting} />
      )}
      <p className="text-xs text-muted-foreground">
        Slack’s tokens live in{" "}
        <InlineButton
          tone="muted"
          onClick={() =>
            void open({ kind: "workspace", workspace: workspace.slug, section: "integrations" })
          }
        >
          Integrations
        </InlineButton>
        . Secrets a tool asks for, like{" "}
        <code className="font-mono">$&#123;secret:JIRA_TOKEN&#125;</code>, are set by each person on
        their own computer in{" "}
        <InlineButton
          tone="muted"
          onClick={() => void open({ kind: "computer", section: "tool-trust" })}
        >
          Tool trust
        </InlineButton>
        .
      </p>

      {setting === null ? null : (
        <SecretValueDialog
          environmentId={environmentId}
          workspace={workspace.slug}
          row={setting}
          onSaved={query.refresh}
          onClose={() => setSetting(null)}
        />
      )}
      {deleting === null ? null : (
        <DeleteSecretDialog
          environmentId={environmentId}
          workspace={workspace.slug}
          workspaceName={workspace.name}
          row={deleting}
          onDeleted={query.refresh}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}
