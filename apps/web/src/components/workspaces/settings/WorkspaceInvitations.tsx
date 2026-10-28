import {
  invitationView,
  sortInvitations,
  type InvitationStatus,
} from "@t3tools/client-runtime/peer-organizations";
import type { EnvironmentId, PeerInvitation, PeerWorkspaceState } from "@t3tools/contracts";
import { useState } from "react";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { SettingsRow, useRelativeTimeTick } from "../../settings/settingsLayout";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { toastManager } from "../../ui/toast";
import { NestedRowTitle, SettingsRowError } from "../PeerSettingsRows";
import { hubFailure } from "../WorkspaceAccess";
import { invitationScope } from "../workspaceMembers.logic";
import { invitationActionRefusal } from "./workspacePeople.logic";

const CHIP: Readonly<Record<InvitationStatus, "info" | "success" | "warning" | "outline">> = {
  pending: "info",
  accepted: "success",
  expired: "warning",
  revoked: "outline",
};

/** A workspace's invitations; null from a Hub that does not list them. */
export function useInvitations(environmentId: EnvironmentId, workspace: string) {
  return useEnvironmentQuery(
    serverEnvironment.peerHubInvitations({ environmentId, input: { workspace } }),
  );
}

/**
 * A workspace's invitations as its admins see them, or a lead the ones they sent (`sentByYou`):
 * pending ones (a failed email first, with the mail service's words), expired ones, and those
 * accepted or revoked lately. A pending or expired invitation can be sent again, which renews it,
 * or revoked. Null from a Hub that does not list invitations: the members list shows its pending
 * ones instead.
 */
export function WorkspaceInvitations({
  environmentId,
  workspace,
  invitations,
  onChanged,
  sentByYou = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: PeerWorkspaceState;
  readonly invitations: ReadonlyArray<PeerInvitation>;
  readonly onChanged: () => void;
  readonly sentByYou?: boolean;
}) {
  const resend = useAtomCommand(serverEnvironment.peerHubResendInvite, { reportFailure: false });
  const revoke = useAtomCommand(serverEnvironment.peerHubWithdrawInvite, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useRelativeTimeTick(60_000);
  const sorted = sortInvitations(invitations, now);
  const names = {
    project: (id: string) =>
      workspace.projects.find(({ project }) => project.id === id)?.project.name,
    task: (id: string) => {
      for (const { work } of workspace.projects) {
        const task = work.tasks.find((candidate) => candidate.id === id);
        if (task !== undefined) return task.key ?? task.title;
      }
      return undefined;
    },
  };

  const act = async (email: string, action: "resend" | "revoke") => {
    setBusy(email);
    setError(null);
    const input = { workspace: workspace.slug, email };
    const result = await (action === "resend"
      ? resend({ environmentId, input })
      : revoke({ environmentId, input }));
    setBusy(null);
    const failure = hubFailure(result);
    if (failure !== null) {
      setError(invitationActionRefusal(email, action, failure, sentByYou));
      return;
    }
    if (result._tag !== "Success") return;
    if (action === "resend" && "delivery" in result.value) {
      const sent = result.value.delivery?.state !== "failed";
      toastManager.add({
        type: sent ? "success" : "error",
        title: sent ? `Sent the invitation to ${email} again` : `Could not email ${email}`,
        ...(sent ? {} : { description: result.value.delivery?.error ?? undefined }),
      });
    }
    onChanged();
  };

  return (
    <SettingsRow
      title={<NestedRowTitle under="workspace">Invitations</NestedRowTitle>}
      description={
        sorted.length === 0
          ? sentByYou
            ? `You have no invitations to ${workspace.name} right now.`
            : `Nobody is invited to ${workspace.name} right now.`
          : sentByYou
            ? "The invitations you sent. Each is emailed and expires after 14 days. Send it again to renew it."
            : "Each invitation is emailed and expires after 14 days. Send it again to renew it."
      }
    >
      {error === null ? null : <SettingsRowError>{error}</SettingsRowError>}
      {sorted.length === 0 ? null : (
        <ul className="divide-y divide-border/60">
          {sorted.map((invitation) => {
            const view = invitationView(invitation, now);
            const mine = busy === invitation.email;
            return (
              <li key={`${invitation.email}:${invitation.at ?? invitation.invitedAt ?? ""}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="flex min-w-0 flex-col">
                    <span className="flex min-w-0 items-center gap-2 text-sm">
                      <span className="truncate">{invitation.email}</span>
                      <Badge variant={CHIP[view.status]}>{view.label}</Badge>
                    </span>
                    <span className="text-xs text-muted-foreground">{view.detail}</span>
                    {invitationScope(invitation, names) === null ? null : (
                      <span className="text-xs text-muted-foreground">
                        {invitationScope(invitation, names)}
                      </span>
                    )}
                    {view.deliveryProblem === null ? null : (
                      <span role="status" className="text-xs text-destructive">
                        {view.deliveryProblem}
                      </span>
                    )}
                  </span>
                  {view.canResend || view.canRevoke ? (
                    <span className="flex shrink-0 items-center gap-2">
                      {view.canResend ? (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() => void act(invitation.email, "resend")}
                        >
                          {mine ? "Working…" : "Resend"}
                        </Button>
                      ) : null}
                      {view.canRevoke ? (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() => void act(invitation.email, "revoke")}
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SettingsRow>
  );
}
