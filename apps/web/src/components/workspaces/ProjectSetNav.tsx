import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, Columns2Icon, PencilIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Dialog, DialogPopup } from "../ui/dialog";
import { Input } from "../ui/input";
import { PeerDialogBody, PeerDialogFooter, PeerDialogHeader } from "./PeerDialog";
import type { ResolvedProjectScope } from "./projectScope.logic";
import { renameSet, SET_SCOPE_PREFIX, type ProjectSet } from "./projectSets.logic";
import { useProjectSets } from "./projectSets";
import { ProjectMark } from "./signals";

/**
 * Under the project button while a project set is in scope: its projects behind a chevron. A row
 * narrows the scope to that project; the set stays one click away in the project menu.
 */
export function ProjectSetMembers({
  scope,
}: {
  readonly scope: ResolvedProjectScope & { readonly setScope: (scope: string) => void };
}) {
  const [open, setOpen] = useState(true);
  const navigate = useNavigate();
  const members = scope.members ?? [];
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={() => setOpen(!open)}
        >
          <ChevronRightIcon aria-hidden className={cn("size-3.5 shrink-0", open && "rotate-90")} />
          <span className="min-w-0 truncate">{members.length} projects</span>
        </button>
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Open side by side"
          title="Open side by side"
          onClick={() =>
            void navigate({
              to: "/workspace/$setId",
              params: { setId: scope.scope.slice(SET_SCOPE_PREFIX.length) },
            })
          }
        >
          <Columns2Icon aria-hidden />
        </Button>
      </div>
      {open ? (
        <ul className="flex flex-col gap-0.5">
          {members.map((member) => (
            <li key={member.scope}>
              <button
                type="button"
                className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md ps-4 pe-2 text-left text-sm text-sidebar-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onClick={() => scope.setScope(member.scope)}
              >
                <ProjectMark
                  name={member.name ?? member.scope}
                  colorKey={member.scope}
                  className="size-4"
                />
                <span className="min-w-0 truncate">{member.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

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
