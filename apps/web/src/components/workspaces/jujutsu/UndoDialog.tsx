import { Undo2Icon } from "lucide-react";

import { Button } from "../../ui/button";
import { Dialog, DialogClose, DialogPopup } from "../../ui/dialog";
import {
  PeerCallout,
  PeerDialogBody,
  PeerDialogFooter,
  PeerDialogHeader,
  PeerDialogMessage,
} from "../PeerDialog";
import type { UndoDialogView } from "./operations.logic";

/**
 * Says what an undo will do before anything runs: the step, the later steps that touched the same
 * changes, and the exact commands. Cancel and closing run nothing.
 */
export function UndoDialog({
  view,
  loading,
  error,
  busy,
  onConfirm,
  onClose,
}: {
  /** Null while the preview is read, or when reading it failed. */
  readonly view: UndoDialogView | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogPopup className="max-w-xl">
        <PeerDialogHeader
          icon={Undo2Icon}
          tone="needs"
          title={view?.heading ?? "Undo this step?"}
          context={
            view === null ? undefined : <span className="font-mono text-xs">{view.step}</span>
          }
        />
        <PeerDialogBody>
          <div className="flex flex-col gap-4">
            {loading ? (
              <p role="status" className="text-sm text-muted-foreground">
                Reading what later steps changed…
              </p>
            ) : null}
            {view?.did ? <p className="text-sm text-foreground">{view.did}</p> : null}
            {view?.warning ? (
              <PeerCallout tone="needs" label={view.warning.title}>
                <ul className="flex flex-col gap-1">
                  {view.warning.later.map((later) => (
                    <li key={later.id}>{later.line}</li>
                  ))}
                </ul>
                <p className="mt-1 text-muted-foreground">{view.warning.merge}</p>
              </PeerCallout>
            ) : null}
            {view?.unread ? <PeerDialogMessage>{view.unread}</PeerDialogMessage> : null}
            {view === null ? null : (
              <pre
                aria-label="The commands Peer will run"
                className="overflow-x-auto rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-xs whitespace-pre-wrap text-foreground"
              >
                {view.commands.join("\n")}
              </pre>
            )}
            {error === null ? null : <PeerDialogMessage tone="error">{error}</PeerDialogMessage>}
          </div>
        </PeerDialogBody>
        <PeerDialogFooter note={view?.note}>
          <DialogClose render={<Button variant="outline" disabled={busy} />}>Cancel</DialogClose>
          <Button disabled={busy || view === null} onClick={onConfirm}>
            {busy ? "Undoing…" : (view?.confirm ?? "Undo")}
          </Button>
        </PeerDialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
