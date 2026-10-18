import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { ChevronsUpDownIcon, PlusIcon, RefreshCwIcon, UsersIcon } from "lucide-react";
import { useState } from "react";

import { ensureLocalApi } from "../../../localApi";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { useRelativeTimeTick } from "../../settings/settingsLayout";
import { Dialog, DialogPopup } from "../../ui/dialog";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../../ui/menu";
import { PeerDialogBody, PeerDialogHeader } from "../PeerDialog";
import { WorkspacePicker } from "../WorkspaceAccess";
import { reportFailure } from "../workFeedback";
import { useLastPeerWorkspace } from "./PeerSettingsContext";
import { useOpenPeerSettings } from "./peerSettingsLinks";
import { withFinally } from "~/lib/withFinally";

/**
 * The person's account in the settings sidebar: who is signed in to which Hub and how fresh the
 * sync is, and the menu that syncs, signs out, or joins another workspace. These belong to the
 * Hub account, not to any one workspace, so they stand apart from the workspace pages.
 */
export function PeerSettingsAccount({
  environmentId,
  status,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
}) {
  useRelativeTimeTick(60_000);
  const sync = useAtomCommand(serverEnvironment.peerHubSync, { reportFailure: false });
  const signOut = useAtomCommand(serverEnvironment.peerHubSignOut, { reportFailure: false });
  const signOutEverywhere = useAtomCommand(serverEnvironment.peerHubSignOutEverywhere, {
    reportFailure: false,
  });
  const open = useOpenPeerSettings();
  const [, setLastWorkspace] = useLastPeerWorkspace();
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState(false);
  const run = async (action: () => Promise<AtomCommandResult<unknown, unknown>>, title: string) => {
    setBusy(true);
    await withFinally(
      async () => {
        reportFailure(title, await action());
      },
      () => {
        setBusy(false);
      },
    );
  };
  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <button
              type="button"
              aria-label="Your Peer account"
              className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-popup-open:bg-sidebar-row-active"
            />
          }
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium text-sidebar-foreground">
              {status.email ?? "Signed in"}
            </span>
            <span className="truncate text-xs text-sidebar-muted-foreground">
              {status.syncing
                ? "Syncing…"
                : status.lastSyncAt
                  ? `Synced ${formatRelativeTimeLabel(status.lastSyncAt)}`
                  : "Not synced yet"}
            </span>
          </span>
          <ChevronsUpDownIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        </MenuTrigger>
        <MenuPopup align="start" side="top" className="min-w-64">
          <MenuGroup>
            <MenuGroupLabel>Hub · {status.hubUrl}</MenuGroupLabel>
            <MenuItem
              disabled={busy || status.syncing}
              onClick={() => void run(() => sync({ environmentId, input: {} }), "Could not sync")}
            >
              <RefreshCwIcon />
              Sync now
            </MenuItem>
            <MenuItem onClick={() => setJoining(true)}>
              <PlusIcon />
              Join or create a workspace…
            </MenuItem>
          </MenuGroup>
          <MenuSeparator />
          <MenuItem
            disabled={busy}
            onClick={() =>
              void run(() => signOut({ environmentId, input: {} }), "Could not sign out")
            }
          >
            Sign out
          </MenuItem>
          <MenuItem
            disabled={busy}
            onClick={() => {
              void (async () => {
                if (
                  await ensureLocalApi().dialogs.confirm(
                    "Sign out of Peer Hub everywhere? Every Hub session ends and your shared-capacity keys in all workspaces are revoked. Local checkouts stay on your computers.",
                  )
                )
                  await run(
                    () => signOutEverywhere({ environmentId, input: {} }),
                    "Could not sign out everywhere",
                  );
              })();
            }}
          >
            Sign out everywhere
          </MenuItem>
        </MenuPopup>
      </Menu>
      <Dialog open={joining} onOpenChange={setJoining}>
        <DialogPopup>
          <PeerDialogHeader
            icon={UsersIcon}
            title="Join or create a workspace"
            description="Workspaces share projects, tools, knowledge and AI capacity."
          />
          <PeerDialogBody>
            <WorkspacePicker
              environmentId={environmentId}
              status={status}
              onJoined={(slug) => {
                setJoining(false);
                setLastWorkspace(slug);
                void open({ kind: "workspace", workspace: slug, section: "general" });
              }}
            />
          </PeerDialogBody>
        </DialogPopup>
      </Dialog>
    </>
  );
}
