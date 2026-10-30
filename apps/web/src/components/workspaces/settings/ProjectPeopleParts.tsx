/**
 * The parts of the People tab (design artboard 04), which New project reuses for choosing who is on
 * a project: the switch between the whole workspace and named people, the table of people, the
 * panel that adds some, and the confirmation before someone is taken off.
 */
import { ChevronRightIcon, EllipsisIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "../../ui/badge";
import { Button, InlineButton } from "../../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../../ui/collapsible";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "../../ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../ui/input-group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../ui/menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui/table";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { PeerDialogBody, PeerDialogFooter } from "../PeerDialog";
import {
  addCandidates,
  moreText,
  type PeopleRow,
  type RemovalWords,
  type WhoMode,
  type WorkspacePerson,
} from "./projectPeople.logic";
import { initialOf } from "./settingsView.logic";

const AVATAR_SIZE = {
  sm: "flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-2xs font-semibold text-muted-foreground",
  md: "flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground",
} as const;

/** A person's initial in a circle. */
export function PersonAvatar({
  name,
  size = "md",
}: {
  readonly name: string;
  readonly size?: keyof typeof AVATAR_SIZE;
}) {
  return (
    <span aria-hidden className={AVATAR_SIZE[size]}>
      {initialOf(name)}
    </span>
  );
}

/** The two ways of saying who is on a project: everyone in the workspace, or the people named. */
export function WhoSwitch({
  label,
  mode,
  disabled = false,
  onChange,
}: {
  readonly label: string;
  readonly mode: WhoMode;
  readonly disabled?: boolean;
  readonly onChange: (mode: WhoMode) => void;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[mode]}
      disabled={disabled}
      onValueChange={(next) => {
        const value = next[0];
        if (value === "all" || value === "selected") onChange(value);
      }}
    >
      <Toggle value="all">Whole workspace</Toggle>
      <Toggle value="selected">Selected people</Toggle>
    </ToggleGroup>
  );
}

/**
 * The people of the workspace who are not on the project yet, to add one at a time. The panel stays
 * open for the next, and says where someone new is invited, since only the workspace's people can be
 * on a project.
 */
export function AddPeoplePanel({
  workspaceName,
  people,
  taken,
  onAdd,
  onOpenPeople,
}: {
  readonly workspaceName: string;
  /** Everyone in the workspace. */
  readonly people: ReadonlyArray<WorkspacePerson>;
  /** The addresses already on the project, which the panel does not offer. */
  readonly taken: ReadonlyArray<string>;
  readonly onAdd: (email: string) => void;
  /** Opens Workspace › People, where someone new is invited. */
  readonly onOpenPeople: () => void;
}) {
  const [query, setQuery] = useState("");
  const candidates = addCandidates(people, taken, query);
  return (
    <section
      aria-label="Add people"
      className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-2.5"
    >
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon aria-hidden className="size-3.5" />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          autoFocus
          aria-label={`Search people in ${workspaceName}`}
          placeholder={`Search people in ${workspaceName}`}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            // Searching is not submitting the form the panel may sit in.
            if (event.key === "Enter") event.preventDefault();
          }}
        />
      </InputGroup>
      {candidates.length === 0 ? (
        <p className="px-2 py-1 text-sm text-muted-foreground">
          {query.trim() === ""
            ? `Everyone in ${workspaceName} is on it already.`
            : `No one in ${workspaceName} matches that.`}
        </p>
      ) : (
        <ul aria-label="People to add" className="flex max-h-64 flex-col overflow-y-auto">
          {candidates.map((person) => (
            <li key={person.email} className="flex items-center gap-2.5 px-2 py-1.5">
              <PersonAvatar name={person.name} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {person.name} <span className="text-muted-foreground">{person.email}</span>
              </span>
              <Button
                size="xs"
                variant="outline"
                aria-label={`Add ${person.name}`}
                onClick={() => onAdd(person.email)}
              >
                Add
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="px-2 text-xs text-muted-foreground">
        Only people in {workspaceName}. Invite someone new in{" "}
        <InlineButton tone="muted" onClick={onOpenPeople}>
          Workspace › People
        </InlineButton>
        .
      </p>
    </section>
  );
}

function HeadLabel({ children }: { readonly children?: string }) {
  return (
    <span className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </span>
  );
}

function RoleCell({ lead }: { readonly lead: boolean | null }) {
  if (lead === null) return <span className="text-muted-foreground">—</span>;
  return lead ? (
    <Badge variant="info" size="lg">
      Lead
    </Badge>
  ) : (
    <span className="text-muted-foreground">Member</span>
  );
}

/**
 * The people on the project, leads first: who they are, whether they lead it, what they may spend
 * (the amount opens the Capacity tab, where it is changed) and, for those who change the project, a
 * menu to make or unmake a lead and to take someone off. Taking off is only for named people: with
 * the whole workspace on the project the menu says to switch first.
 */
export function PeopleTable({
  rows,
  projectName,
  workspaceName,
  more,
  editable,
  removable,
  onToggleLead,
  onAskRemove,
  onOpenCapacity,
}: {
  readonly rows: ReadonlyArray<PeopleRow>;
  readonly projectName: string;
  readonly workspaceName: string;
  /** People on the project that are not listed (for the whole workspace). */
  readonly more: number;
  /** The person changes the project: the rows have their menu. */
  readonly editable: boolean;
  /** Named people can be taken off; the whole workspace cannot. */
  readonly removable: boolean;
  readonly onToggleLead: (row: PeopleRow) => void;
  readonly onAskRemove: (row: PeopleRow) => void;
  readonly onOpenCapacity: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <Table aria-label={`People on ${projectName}`}>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">
              <HeadLabel>Person</HeadLabel>
            </TableHead>
            <TableHead scope="col">
              <HeadLabel>{`In ${projectName}`}</HeadLabel>
            </TableHead>
            <TableHead scope="col">
              <HeadLabel>Allocation</HeadLabel>
            </TableHead>
            <TableHead scope="col">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.email}>
              <TableCell>
                <span className="flex min-w-0 items-center gap-2.5 py-0.5">
                  <PersonAvatar name={row.name} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">
                      {row.name}
                      {row.you ? (
                        <span className="font-normal text-muted-foreground"> (you)</span>
                      ) : null}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{row.email}</span>
                  </span>
                </span>
              </TableCell>
              <TableCell>
                <RoleCell lead={row.lead} />
              </TableCell>
              <TableCell>
                {row.allocation === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <InlineButton onClick={onOpenCapacity}>
                    <span>{row.allocation.text}</span>
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      · {row.allocation.source}
                    </span>
                  </InlineButton>
                )}
              </TableCell>
              <TableCell>
                {editable ? (
                  <Menu>
                    <MenuTrigger
                      render={
                        <Button
                          size="icon-xs"
                          variant="ghost-muted"
                          aria-label={`Actions for ${row.name}`}
                        />
                      }
                    >
                      <EllipsisIcon aria-hidden />
                    </MenuTrigger>
                    <MenuPopup align="end">
                      <MenuItem onClick={() => onToggleLead(row)}>
                        {row.lead === true ? "Remove as lead" : "Make lead"}
                      </MenuItem>
                      {removable ? (
                        <MenuItem variant="destructive" onClick={() => onAskRemove(row)}>
                          Remove from {projectName}…
                        </MenuItem>
                      ) : (
                        <p className="max-w-60 px-2 py-1.5 text-xs text-muted-foreground">
                          To remove someone, switch to Selected people.
                        </p>
                      )}
                    </MenuPopup>
                  </Menu>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4}>
                <span className="text-muted-foreground">No one is on {projectName} yet.</span>
              </TableCell>
            </TableRow>
          ) : null}
          {more > 0 ? (
            <TableRow>
              <TableCell colSpan={4}>
                <span className="text-muted-foreground">{moreText(more, workspaceName)}</span>
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}

/** What taking a person off the project does, before it does it: the change only joins the draft. */
export function RemovePersonDialog({
  words,
  onConfirm,
  onClose,
}: {
  readonly words: RemovalWords;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <div className="pe-6">
            <DialogTitle>{words.title}</DialogTitle>
          </div>
        </DialogHeader>
        <PeerDialogBody>
          <ul className="flex list-disc flex-col gap-1.5 ps-5 text-sm text-foreground">
            {words.consequences.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </PeerDialogBody>
        <PeerDialogFooter note="Nothing changes until you save.">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {words.confirm}
          </Button>
        </PeerDialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** What a lead may do, folded away under the table. */
export function LeadDisclosure({
  projectName,
  workspaceName,
}: {
  readonly projectName: string;
  readonly workspaceName: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
      <Collapsible>
        <CollapsibleTrigger
          type="button"
          className="group flex w-full items-center gap-2 text-sm font-medium text-foreground"
        >
          <ChevronRightIcon
            aria-hidden
            className="size-3.5 text-muted-foreground group-data-panel-open:rotate-90"
          />
          What can a lead do?
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <p className="pt-2 text-sm text-muted-foreground">
            Change {projectName}’s settings: people, repositories, tools, allocations and
            coordination. Delete other people’s tasks and release their locks. Create CI credentials
            for notifications. Approve Memory for {projectName}. Admins of {workspaceName} can
            always do the same.
          </p>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}
