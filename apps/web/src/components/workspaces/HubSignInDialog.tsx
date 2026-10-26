import { LogInIcon } from "lucide-react";
import { create } from "zustand";

import { Button } from "../ui/button";
import { Dialog, DialogPopup } from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import { hubSignInStage } from "./hubSignIn.logic";
import { PeerDialogBody, PeerDialogFooter, PeerDialogHeader } from "./PeerDialog";
import { usePeerHub } from "./projectScope";
import { WorkspacePicker, WorkspaceSignIn } from "./WorkspaceAccess";

const useHubSignInDialog = create<{ open: boolean }>(() => ({ open: false }));

/** Opens the Peer Hub sign-in from anywhere: the sidebar, Work, the command palette. */
export function openHubSignIn() {
  useHubSignInDialog.setState({ open: true });
}

function close() {
  useHubSignInDialog.setState({ open: false });
}

/**
 * The one sign-in dialog, mounted once at the app's root so it outlives the sidebar line that
 * opened it (that line turns into the organization's name the moment the person is signed in).
 * It walks the same path as the first-run step: email, code, then the organization to choose or
 * one founded for the person, and says where they are once they are in.
 */
export function HubSignInDialogHost() {
  const open = useHubSignInDialog((state) => state.open);
  return open ? <HubSignInDialog /> : null;
}

function HubSignInDialog() {
  const { environmentId, status } = usePeerHub();
  const stage = environmentId === null ? "connecting" : hubSignInStage(status);
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogPopup>
        {stage === "connecting" || environmentId === null || status === null ? (
          <>
            <PeerDialogHeader icon={LogInIcon} title="Sign in to Peer Hub" />
            <PeerDialogBody>
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                Connecting to this computer’s Peer…
              </p>
            </PeerDialogBody>
          </>
        ) : stage === "sign-in" ? (
          <>
            <PeerDialogHeader
              icon={LogInIcon}
              title="Sign in to Peer Hub"
              description="Your organizations, invitations and the projects your team shares. Peer keeps working on this computer without it."
            />
            <PeerDialogBody>
              <WorkspaceSignIn
                environmentId={environmentId}
                status={status}
                idPrefix="peer-hub-dialog"
                autoFocus
              />
            </PeerDialogBody>
          </>
        ) : stage === "choose" ? (
          <>
            <PeerDialogHeader
              icon={LogInIcon}
              title="Choose your organization"
              description={`Signed in as ${status.email ?? "you"}.`}
            />
            <PeerDialogBody>
              <WorkspacePicker
                environmentId={environmentId}
                status={status}
                autoFocus
                onJoined={close}
                onOpenSettings={close}
              />
            </PeerDialogBody>
          </>
        ) : (
          <>
            <PeerDialogHeader
              icon={LogInIcon}
              title="You’re signed in"
              description={`Signed in as ${status.email ?? "you"}, in ${status.workspaces
                .map((workspace) => workspace.name)
                .join(", ")}.`}
            />
            <PeerDialogFooter>
              <Button autoFocus onClick={close}>
                Done
              </Button>
            </PeerDialogFooter>
          </>
        )}
      </DialogPopup>
    </Dialog>
  );
}
