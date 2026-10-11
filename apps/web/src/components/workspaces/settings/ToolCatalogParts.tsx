/**
 * The parts of the tool catalog page (design artboard 17) around the editor (`ToolCatalogEditor`):
 * the list of tools, the form that starts one, the confirmation that deletes one, and what ends the
 * editor (the note and the buttons). They draw what `toolCatalog.logic` works out and hand every
 * edit back to the page, which writes it to the draft.
 */
import { PlusIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { cn } from "../../../lib/utils";
import { Button } from "../../ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogPopup, DialogTitle } from "../../ui/dialog";
import { Input } from "../../ui/input";
import { PeerDialogBody, PeerDialogFooter, PeerStackedField } from "../PeerDialog";
import { NotSaved } from "./CapacityCoordinationParts";
import {
  checkNewTool,
  deleteWords,
  toolIdFromName,
  toolMeta,
  type CatalogTool,
} from "./toolCatalog.logic";

const problemClass = "text-xs text-destructive-foreground";

/**
 * What a text field shows while the person types in it: what they typed, even where the draft does
 * not take it (an address that is not one). Leaving the field shows the draft's value again.
 */
export function useTyped(committed: string) {
  const [typed, setTyped] = useState<string | null>(null);
  return { shown: typed ?? committed, typed, type: setTyped, leave: () => setTyped(null) };
}

export const Problem = ({ children }: { readonly children: ReactNode }) => (
  <p role="alert" className={problemClass}>
    {children}
  </p>
);

// ---- the list -------------------------------------------------------------------------------------

/**
 * The catalog's tools, each with how it is reached and where it is used. While a tool has unsaved
 * changes the others are shut: switching would leave the changes behind, unseen.
 */
export function ToolList({
  tools,
  selectedId,
  notSaved,
  locked,
  canCreate,
  onSelect,
  onNew,
}: {
  readonly tools: ReadonlyArray<CatalogTool>;
  readonly selectedId: string | null;
  readonly notSaved: (id: string) => boolean;
  readonly locked: boolean;
  readonly canCreate: boolean;
  readonly onSelect: (id: string) => void;
  readonly onNew: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {tools.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-3.5 py-3 text-sm text-muted-foreground">
          No tools yet.
        </p>
      ) : (
        <ul
          aria-label="Tools"
          className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card"
        >
          {tools.map((tool) => {
            const selected = tool.id === selectedId;
            return (
              <li key={tool.id}>
                <button
                  type="button"
                  aria-current={selected || undefined}
                  disabled={locked && !selected}
                  className={cn(
                    "flex w-full cursor-pointer flex-col items-start gap-0.5 px-3.5 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-64",
                    selected ? "bg-accent" : "hover:bg-accent/50",
                  )}
                  onClick={() => onSelect(tool.id)}
                >
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                    {tool.name}
                    {notSaved(tool.id) ? <NotSaved /> : null}
                  </span>
                  <span className="text-xs text-muted-foreground">{toolMeta(tool)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {canCreate ? (
        <Button
          className="self-start"
          size="sm"
          variant="outline"
          disabled={locked}
          onClick={onNew}
        >
          <PlusIcon aria-hidden />
          New tool
        </Button>
      ) : null}
      {locked ? (
        <p className="text-xs text-muted-foreground">
          Save or cancel your changes to open another tool.
        </p>
      ) : null}
    </div>
  );
}

/** The panel every tool's editor and the form that starts one share. */
export function EditorPanel({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-card p-4.5"
    >
      {children}
    </section>
  );
}

/**
 * What a new tool is called and what it is known by. The id follows the name until the person
 * writes their own, and is fixed once the tool is saved (projects name their tools by it).
 */
export function NewToolForm({
  taken,
  onCreate,
  onCancel,
}: {
  readonly taken: ReadonlySet<string>;
  readonly onCreate: (id: string, name: string) => void;
  readonly onCancel: () => void;
}) {
  const nameId = useId();
  const idId = useId();
  const [name, setName] = useState("");
  const [typedId, setTypedId] = useState<string | null>(null);
  const id = typedId ?? toolIdFromName(name);
  const check = checkNewTool({ name, id, taken });
  return (
    <EditorPanel label="New tool">
      <h2 className="text-base font-semibold">New tool</h2>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (check.ok) onCreate(check.id, check.name);
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PeerStackedField label="Name" htmlFor={nameId}>
            <Input
              id={nameId}
              autoFocus
              autoComplete="off"
              placeholder="Postgres staging"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </PeerStackedField>
          <PeerStackedField label="ID" htmlFor={idId} hint="Fixed once saved.">
            <Input
              id={idId}
              font="mono"
              autoComplete="off"
              spellCheck={false}
              placeholder="postgres-staging"
              value={id}
              aria-invalid={(!check.ok && check.problem !== null) || undefined}
              onChange={(event) => setTypedId(event.target.value)}
            />
          </PeerStackedField>
        </div>
        {!check.ok && check.problem !== null ? <Problem>{check.problem}</Problem> : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={!check.ok}>
            Add tool
          </Button>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </EditorPanel>
  );
}

// ---- deleting -------------------------------------------------------------------------------------

/**
 * What deleting a tool takes with it, before the review: it leaves the catalog and every project
 * that uses it, which are named. Confirming does not delete anything yet.
 */
export function DeleteToolDialog({
  tool,
  projects,
  unsaved,
  onConfirm,
  onClose,
}: {
  readonly tool: string;
  readonly projects: ReadonlyArray<string>;
  /** The page has changes that are not saved: the deletion takes them away. */
  readonly unsaved: boolean;
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
          <div className="flex min-w-0 flex-col gap-1.5 pe-6">
            <DialogTitle>Delete {tool}?</DialogTitle>
            <DialogDescription>This goes away for everyone:</DialogDescription>
          </div>
        </DialogHeader>
        <PeerDialogBody>
          <ul className="flex list-disc flex-col gap-1.5 ps-5 text-sm text-foreground">
            {[
              ...deleteWords(tool, projects),
              ...(unsaved ? ["Your changes to the catalog that are not saved are dropped."] : []),
            ].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {projects.length === 0 ? null : (
            <ul aria-label="Projects that use it" className="flex flex-wrap gap-1.5">
              {projects.map((project) => (
                <li key={project} className="rounded-md bg-muted px-2 py-0.5 text-sm">
                  {project}
                </li>
              ))}
            </ul>
          )}
        </PeerDialogBody>
        <PeerDialogFooter note="You review the change before it is saved.">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete {tool}
          </Button>
        </PeerDialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

// ---- the end of the editor ------------------------------------------------------------------------

/**
 * What saving does that the fields do not say (a definition that changes pauses the tool for the
 * people who approved it), and Save, Cancel and Delete tool…. Save goes into the review, so nothing
 * is saved by pressing it; it is off while nothing changed or what is typed cannot be saved.
 */
export function EditorFooter({
  note,
  dirty,
  valid,
  stale,
  onSave,
  onCancel,
  onDelete,
}: {
  /** "Saving pauses Postgres staging for the 5 people in Booking …", where it does. */
  readonly note: string | null;
  readonly dirty: boolean;
  readonly valid: boolean;
  /** The settings changed since the changes were started. */
  readonly stale: boolean;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  /** Without it the person does not delete tools. */
  readonly onDelete: (() => void) | undefined;
}) {
  return (
    <>
      {note === null ? null : (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-lg border border-info/32 bg-info/4 px-3 py-2.5 text-sm text-foreground"
        >
          <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-info" />
          <span className="min-w-0">{note}</span>
        </div>
      )}
      {dirty && stale ? (
        <p className="text-xs text-muted-foreground">Settings changed since you started.</p>
      ) : null}
      {dirty && !valid ? (
        <p className="text-xs text-muted-foreground">Fix what is marked above to save.</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!dirty || !valid} onClick={onSave}>
          Save
        </Button>
        <Button variant="outline" disabled={!dirty} onClick={onCancel}>
          Cancel
        </Button>
        {onDelete === undefined ? null : (
          <Button className="ms-auto" variant="destructive-outline" onClick={onDelete}>
            Delete tool…
          </Button>
        )}
      </div>
    </>
  );
}
