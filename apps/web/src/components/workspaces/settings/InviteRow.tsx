import type { EnvironmentId, PeerWorkspaceState } from "@t3tools/contracts";
import { useState } from "react";

import { SettingsRow } from "../../settings/settingsLayout";
import { Button } from "../../ui/button";
import { NestedRowTitle } from "../PeerSettingsRows";
import { inviter } from "../workspaceMembers.logic";
import { InviteDialog } from "./WorkspacePeopleParts";

/**
 * Invites someone by address: people outside the workspace's domains join this way. The row opens
 * the invitation, where the role and the projects are chosen; a lead who is no admin invites
 * members to the projects they lead.
 */
export function InviteRow({
  environmentId,
  workspace,
  onInvited,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: PeerWorkspaceState;
  /** After the dialog sent at least one invitation. */
  readonly onInvited?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const who = inviter(workspace);
  if (who === null) return null;
  return (
    <>
      <SettingsRow
        title={<NestedRowTitle under="workspace">Invite</NestedRowTitle>}
        description={
          who.as === "admin"
            ? "People outside the workspace's domains join by invite: they get an email, sign in with that address and see the workspace. Invite them as members or as admins, to the whole workspace or to named projects."
            : `Invite someone to ${who.projects.map((project) => project.name).join(", ")}, which you lead: they get an email, sign in with that address and are on the projects you name, and no other. A task of one of them can wait for them.`
        }
        control={
          <Button size="sm" variant="outline" aria-haspopup="dialog" onClick={() => setOpen(true)}>
            Invite…
          </Button>
        }
      />
      {open ? (
        <InviteDialog
          environmentId={environmentId}
          workspace={workspace}
          onClose={() => setOpen(false)}
          {...(onInvited === undefined ? {} : { onInvited })}
        />
      ) : null}
    </>
  );
}
