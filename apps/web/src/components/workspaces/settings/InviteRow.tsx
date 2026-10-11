import type { EnvironmentId, PeerWorkspaceState } from "@t3tools/contracts";
import { useState } from "react";

import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { SettingsRow } from "../../settings/settingsLayout";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { toastManager } from "../../ui/toast";
import { NestedRowTitle } from "../PeerSettingsRows";
import { reportFailure } from "../workFeedback";

/** Invites someone by address: people outside the workspace's domains join this way. */
export function InviteRow({
  environmentId,
  workspace,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: PeerWorkspaceState;
}) {
  const invite = useAtomCommand(serverEnvironment.peerHubInvite, { reportFailure: false });
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <SettingsRow
      title={<NestedRowTitle under="workspace">Invite</NestedRowTitle>}
      description="People outside the workspace's domains join by invite: they sign in with that address and see the workspace."
      control={
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || email.trim() === "") return;
            setBusy(true);
            void invite({
              environmentId,
              input: { workspace: workspace.slug, email: email.trim() },
            })
              .then((result) => {
                reportFailure(`Could not invite ${email.trim()}`, result);
                if (result._tag === "Success") {
                  toastManager.add({ type: "success", title: `Invited ${email.trim()}` });
                  setEmail("");
                }
              })
              .finally(() => setBusy(false));
          }}
        >
          <Input
            size="sm"
            className="w-56"
            type="email"
            placeholder="colleague@example.com"
            value={email}
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
            aria-label={`Invite to ${workspace.name}`}
          />
          <Button size="sm" variant="outline" type="submit" disabled={busy || email.trim() === ""}>
            Invite
          </Button>
        </form>
      }
    />
  );
}
