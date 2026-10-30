import { useState } from "react";

import { Button } from "../ui/button";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog";
import { PeerDialogBody, PeerDialogFooter, PeerDialogMessage } from "./PeerDialog";
import { ProjectAccessFields } from "./settings/people/AccessFields";
import { accessOf, limitOf } from "./settings/people/people.logic";
import type { ProjectChoice } from "./workspaceMembers.logic";

/**
 * Where a member works: every project open to the team, or the ones ticked. The projects of a limit
 * the admin is not on stay in the list by their ids, so saving keeps them.
 */
export function MemberProjectsDialog({
  name,
  projects,
  limit,
  busy,
  error,
  onSave,
  onCancel,
}: {
  readonly name: string;
  readonly projects: ReadonlyArray<ProjectChoice>;
  /** What they are on now; null for a member on every project. */
  readonly limit: ReadonlyArray<string> | null;
  readonly busy: boolean;
  readonly error: string | null;
  /** The projects to keep them on, or null for every project. */
  readonly onSave: (projects: ReadonlyArray<string> | null) => void;
  readonly onCancel: () => void;
}) {
  const [access, setAccess] = useState(() => accessOf(limit));
  const empty = access.mode === "selected" && access.projects.length === 0;
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <div className="pe-6">
            <DialogTitle>Project access for {name}</DialogTitle>
          </div>
        </DialogHeader>
        <PeerDialogBody>
          <ProjectAccessFields
            value={access}
            projects={projects}
            disabled={busy}
            onChange={setAccess}
          />
          {error === null ? null : <PeerDialogMessage tone="error">{error}</PeerDialogMessage>}
        </PeerDialogBody>
        <PeerDialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={busy || empty} onClick={() => onSave(limitOf(access))}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </PeerDialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
