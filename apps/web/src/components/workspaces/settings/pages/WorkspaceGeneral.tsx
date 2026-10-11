import { domainStateLabel } from "@t3tools/client-runtime/peer-domain-offers";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { serverEnvironment } from "../../../../state/server";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { SettingsRow, SettingsSection } from "../../../settings/settingsLayout";
import { Button } from "../../../ui/button";
import { ProjectMark } from "../../signals";
import { reportFailure } from "../../workFeedback";
import { CheckoutBadge } from "../CheckoutBadge";
import type { WorkspacePageProps } from "../pageProps";
import { workspaceRoleBadge } from "../peerSettings.logic";
import { ComingInThisChange, PeerSettingsPage } from "../PeerSettingsPage";
import { HostedWorkspaceSettings } from "../PluginSlots";

/**
 * A workspace's General page. Until the new page is built it holds what the Workspaces page said
 * of the workspace: its domains, configuration and folder, Leave, and the shared knowledge.
 */
export function WorkspaceGeneral({ environmentId, status, workspace }: WorkspacePageProps) {
  const leave = useAtomCommand(serverEnvironment.peerHubLeaveWorkspace, { reportFailure: false });
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const knowledge = workspace.companyKnowledge;
  return (
    <PeerSettingsPage
      title="General"
      mark={<ProjectMark name={workspace.name} colorKey={workspace.slug} className="size-7" />}
      badge={workspaceRoleBadge(workspace.role)}
    >
      <SettingsSection title="General" hideTitle>
        <SettingsRow
          title={workspace.name}
          description={[
            workspace.domainClaims?.length
              ? workspace.domainClaims
                  .map((claim) => domainStateLabel(claim.state, claim.domain))
                  .join(", ")
              : workspace.allowedDomains.length > 0
                ? `Open to ${workspace.allowedDomains.map((d) => `@${d}`).join(", ")}`
                : "Invite only",
            workspace.revision ? `configuration ${workspace.revision}` : null,
            `projects under ${status.workspaceRoot}/${workspace.slug}`,
          ]
            .filter(Boolean)
            .join(" · ")}
          control={
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void leave({ environmentId, input: { workspace: workspace.slug } })
                  .then((result) => {
                    reportFailure(`Could not leave ${workspace.name}`, result);
                    // The workspace is gone from the list: open what is left.
                    if (result._tag === "Success") void navigate({ to: "/settings/peer" });
                  })
                  .finally(() => setBusy(false));
              }}
            >
              Leave
            </Button>
          }
        />
        {workspace.error ? (
          <SettingsRow title="Could not refresh" description={workspace.error} />
        ) : null}
        {knowledge === null ? null : (
          <SettingsRow
            title="Shared knowledge"
            description={`${knowledge.repository} → ${knowledge.path}${knowledge.error ? ` (${knowledge.error})` : ""}`}
            status={<CheckoutBadge state={knowledge.state} />}
          />
        )}
        <HostedWorkspaceSettings
          host="general"
          environmentId={environmentId}
          status={status}
          workspace={workspace}
        />
      </SettingsSection>
      <ComingInThisChange>
        the workspace’s name, email domains with DNS verification, company knowledge and Settings as
        YAML
      </ComingInThisChange>
    </PeerSettingsPage>
  );
}
