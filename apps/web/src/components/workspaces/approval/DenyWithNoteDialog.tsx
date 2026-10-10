import { MessageSquareXIcon } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "../../ui/button";
import { Dialog, DialogClose, DialogPopup } from "../../ui/dialog";
import { Textarea } from "../../ui/textarea";
import { PeerDialogBody, PeerDialogFooter, PeerDialogHeader } from "../PeerDialog";

/**
 * Declines an approval with a note: the agent is told no, and gets the person's reason as their
 * next message, so it can continue another way.
 */
export function DenyWithNoteDialog({
  open,
  onOpenChange,
  onDeny,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Declines, then sends the note; resolves once both are done. */
  readonly onDeny: (note: string) => Promise<void>;
}) {
  const formId = useId();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogPopup>
        <PeerDialogHeader
          icon={MessageSquareXIcon}
          tone="needs"
          title="Deny with a note"
          context="Tell the agent why. It gets this as your answer and continues."
        />
        <PeerDialogBody>
          <form
            id={formId}
            onSubmit={(event) => {
              event.preventDefault();
              const text = note.trim();
              if (text === "" || busy) return;
              setBusy(true);
              void onDeny(text).finally(() => {
                setBusy(false);
                setNote("");
                onOpenChange(false);
              });
            }}
          >
            <Textarea
              aria-label="Why you deny it"
              autoFocus
              value={note}
              disabled={busy}
              maxLength={4_000}
              placeholder="For example: don't migrate staging yet. Write a reversible migration and run it with --dry-run first."
              onChange={(event) => setNote(event.target.value)}
            />
          </form>
        </PeerDialogBody>
        <PeerDialogFooter>
          <DialogClose render={<Button variant="outline" disabled={busy} />}>Cancel</DialogClose>
          <Button type="submit" form={formId} disabled={busy || note.trim() === ""}>
            {busy ? "Sending…" : "Deny and send note"}
          </Button>
        </PeerDialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
