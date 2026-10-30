import { PEER_REQUEST_REASON_MAX } from "@t3tools/contracts";
import { BanIcon } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "../../ui/button";
import { Dialog, DialogClose, DialogPopup } from "../../ui/dialog";
import { Textarea } from "../../ui/textarea";
import {
  PeerDialogBody,
  PeerDialogFooter,
  PeerDialogHeader,
  PeerStackedField,
} from "../PeerDialog";

/** Declining a message, with a reason everyone in the room reads, or without one. */
export function DeclineDialog({
  busy,
  onDecline,
  onClose,
}: {
  readonly busy: boolean;
  readonly onDecline: (reason: string) => void;
  readonly onClose: () => void;
}) {
  const fieldId = useId();
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="max-w-md">
        <PeerDialogHeader
          icon={BanIcon}
          title="Decline this message"
          description="Your agent will not hear it, and everyone in the room sees that you declined."
        />
        <PeerDialogBody>
          <PeerStackedField htmlFor={fieldId} label="Why (optional)">
            <Textarea
              id={fieldId}
              autoFocus
              value={reason}
              maxLength={PEER_REQUEST_REASON_MAX}
              onChange={(event) => setReason(event.target.value)}
            />
          </PeerStackedField>
        </PeerDialogBody>
        <PeerDialogFooter>
          <DialogClose render={<Button variant="ghost" disabled={busy} />}>
            Keep waiting
          </DialogClose>
          <Button variant="outline" disabled={busy} onClick={() => onDecline(reason.trim())}>
            Decline
          </Button>
        </PeerDialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
