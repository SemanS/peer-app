import { FolderTreeIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { Dialog, DialogPopup } from "../ui/dialog";
import { PeerDialogBody, PeerDialogFooter, PeerDialogHeader } from "./PeerDialog";
import { UnderChip } from "./UnderChip";
import { taskLabel, type WorkProjectNode, type WorkTaskNode } from "./workTree.logic";

/** Moves a task under another item of its project, or out from under one. */
export function MoveUnderDialog({
  project,
  task,
  onMove,
  onClose,
}: {
  readonly project: WorkProjectNode;
  readonly task: WorkTaskNode;
  /** null: a root. */
  readonly onMove: (parent: string | null) => void;
  readonly onClose: () => void;
}) {
  const [parent, setParent] = useState<string | null>(task.parent ?? null);
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPopup>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            onMove(parent);
            onClose();
          }}
        >
          <PeerDialogHeader icon={FolderTreeIcon} title="Move under…" context={taskLabel(task)} />
          <PeerDialogBody>
            <UnderChip
              project={project}
              value={parent}
              moving={task.id}
              defaultOpen
              onChange={setParent}
            />
          </PeerDialogBody>
          <PeerDialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={parent === (task.parent ?? null)}>
              Move
            </Button>
          </PeerDialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
