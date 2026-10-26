import type { EnvironmentId, PeerWorkspaceState } from "@t3tools/contracts";
import { useState } from "react";

import { SettingsRow } from "../../settings/settingsLayout";
import { Button } from "../../ui/button";
import { NestedRowTitle } from "../PeerSettingsRows";
import { InviteDialog } from "./WorkspacePeopleParts";

/**
 * Invites someone by address: people outside the workspace's domains join this way. The row opens
 * the invitation, where the role is chosen.
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
  return (
    <>
      <SettingsRow
        title={<NestedRowTitle under="workspace">Invite</NestedRowTitle>}
        description="People outside the workspace's domains join by invite: they get an email, sign in with that address and see the workspace. Invite them as members or as admins."
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
