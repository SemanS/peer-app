import { PencilIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { Dialog, DialogPopup } from "../ui/dialog";
import { Input } from "../ui/input";
import { PeerDialogBody, PeerDialogFooter, PeerDialogHeader } from "./PeerDialog";
import { renameSet, type ProjectSet } from "./projectSets.logic";
import { useProjectSets } from "./projectSets";

/** Names a project set; it stays open only while `set` is. */
export function RenameProjectSetDialog({
  set,
  onClose,
}: {
  readonly set: ProjectSet | null;
  readonly onClose: () => void;
}) {
  return (
    <Dialog
      open={set !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup>
        {set === null ? null : <RenameForm key={set.id} set={set} onClose={onClose} />}
      </DialogPopup>
    </Dialog>
  );
}

function RenameForm({ set, onClose }: { readonly set: ProjectSet; readonly onClose: () => void }) {
  const [sets, setSets] = useProjectSets();
  const [name, setName] = useState(set.name);
  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        setSets(renameSet(sets, set.id, name));
        onClose();
      }}
    >
      <PeerDialogHeader icon={PencilIcon} title="Rename workspace" context={set.name} />
      <PeerDialogBody>
        <Input
          aria-label="Workspace name"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </PeerDialogBody>
      <PeerDialogFooter>
        <Button variant="ghost" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={name.trim() === ""}>
          Rename
        </Button>
      </PeerDialogFooter>
    </form>
  );
}
