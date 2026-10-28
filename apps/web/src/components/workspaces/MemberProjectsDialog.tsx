import { useState } from "react";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog";
import { PeerDialogBody, PeerDialogFooter, PeerDialogMessage } from "./PeerDialog";
import type { ProjectChoice } from "./workspaceMembers.logic";

/**
 * An admin changes the projects a member is on, and no other: ticks more or fewer, or lifts the
 * limit, which puts them on every project open to the workspace's members. A project of the limit
 * the admin is not on stays in the list by its id, so saving keeps it.
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
  /** What they are on now; null for a member without a limit. */
  readonly limit: ReadonlyArray<string> | null;
  readonly busy: boolean;
  readonly error: string | null;
  /** The projects to keep them on, or null to lift the limit. */
  readonly onSave: (projects: ReadonlyArray<string> | null) => void;
  readonly onCancel: () => void;
}) {
  const [picked, setPicked] = useState<ReadonlyArray<string>>(limit ?? []);
  const known = new Set(projects.map((project) => project.id));
  const choices = [
    ...projects,
    ...(limit ?? []).filter((id) => !known.has(id)).map((id) => ({ id, name: id })),
  ];
  const toggle = (id: string, on: boolean) =>
    setPicked((current) =>
      on
        ? [...current.filter((entry) => entry !== id), id]
        : current.filter((entry) => entry !== id),
    );
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
            <DialogTitle>Projects of {name}</DialogTitle>
          </div>
        </DialogHeader>
        <PeerDialogBody>
          <fieldset className="flex flex-col gap-2.5">
            <legend className="pb-2 text-sm text-muted-foreground">
              {`${name} is on the projects you tick, and no other. Lift the limit to put them on every project open to the workspace's members.`}
            </legend>
            {choices.map((project) => (
              <label
                key={project.id}
                className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground"
              >
                <Checkbox
                  checked={picked.includes(project.id)}
                  disabled={busy}
                  onCheckedChange={(on) => toggle(project.id, on)}
                />
                {project.name}
              </label>
            ))}
          </fieldset>
          {error === null ? null : <PeerDialogMessage tone="error">{error}</PeerDialogMessage>}
        </PeerDialogBody>
        <PeerDialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          {limit === null ? null : (
            <Button variant="outline" disabled={busy} onClick={() => onSave(null)}>
              Lift the limit
            </Button>
          )}
          <Button disabled={busy || picked.length === 0} onClick={() => onSave(picked)}>
            {busy ? "Saving…" : limit === null ? "Limit to these projects" : "Save"}
          </Button>
        </PeerDialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
