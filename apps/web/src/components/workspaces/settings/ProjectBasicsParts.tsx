/**
 * The parts of the Basics tab (design artboard 05): the form's text fields over the page's draft,
 * the read-only project id, and the confirmation that deletes a project.
 */
import { LockIcon } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "../../ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogPopup, DialogTitle } from "../../ui/dialog";
import { Input } from "../../ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../ui/input-group";
import { Textarea } from "../../ui/textarea";
import { PeerDialogBody, PeerDialogFooter, PeerStackedField } from "../PeerDialog";
import {
  DESCRIPTION_MAX,
  NAME_REQUIRED,
  confirmsDeletion,
  descriptionCount,
  settledText,
} from "./projectBasics.logic";

/**
 * What a text field shows while the person types in it: what they typed, even where the draft takes
 * it trimmed or not at all (a name cannot be blank). Leaving the field shows the draft's value
 * again.
 */
function useTyped(committed: string) {
  const [typed, setTyped] = useState<string | null>(null);
  return { shown: typed ?? committed, type: setTyped, leave: () => setTyped(null) };
}

const Optional = () => <span className="font-normal text-muted-foreground">optional</span>;

/** The project's name: a blank one is not taken into the draft, and the field says so. */
export function NameField({
  value,
  disabled,
  onCommit,
}: {
  /** The name as the draft has it. */
  readonly value: string;
  readonly disabled: boolean;
  readonly onCommit: (name: string) => void;
}) {
  const id = useId();
  const field = useTyped(value);
  const blank = field.shown.trim() === "";
  return (
    <PeerStackedField label="Name" htmlFor={id}>
      <Input
        id={id}
        autoComplete="off"
        value={field.shown}
        disabled={disabled}
        aria-invalid={blank || undefined}
        onChange={(event) => {
          const text = event.target.value;
          field.type(text);
          const name = settledText(text);
          if (name !== undefined) onCommit(name);
        }}
        onBlur={field.leave}
      />
      {blank ? (
        <p role="alert" className="text-xs text-destructive-foreground">
          {NAME_REQUIRED}
        </p>
      ) : null}
    </PeerStackedField>
  );
}

/** The id the project is stored and billed under, which never changes. */
export function ProjectIdField({
  id: projectId,
  projectName,
}: {
  readonly id: string;
  readonly projectName: string;
}) {
  const id = useId();
  return (
    <PeerStackedField
      label="Project ID"
      htmlFor={id}
      hint={`Fixed: it names ${projectName} in storage and on the gateway.`}
    >
      <InputGroup>
        <InputGroupAddon>
          <LockIcon aria-hidden className="size-3.5" />
        </InputGroupAddon>
        <InputGroupInput id={id} readOnly font="mono" value={projectId} />
      </InputGroup>
    </PeerStackedField>
  );
}

/** Who the work is for; blank removes it from the project. */
export function ClientField({
  value,
  disabled,
  onCommit,
}: {
  readonly value: string;
  readonly disabled: boolean;
  /** The client trimmed, or undefined for none. */
  readonly onCommit: (client: string | undefined) => void;
}) {
  const id = useId();
  const field = useTyped(value);
  return (
    <PeerStackedField
      label={
        <>
          Client <Optional />
        </>
      }
      htmlFor={id}
      hint="Marks client work. Peer warns when it runs on a consumer AI plan."
    >
      <Input
        id={id}
        autoComplete="off"
        value={field.shown}
        disabled={disabled}
        onChange={(event) => {
          field.type(event.target.value);
          onCommit(settledText(event.target.value));
        }}
        onBlur={field.leave}
      />
    </PeerStackedField>
  );
}

/** What the project is, with how much of its room is used. */
export function DescriptionField({
  value,
  disabled,
  onCommit,
}: {
  readonly value: string;
  readonly disabled: boolean;
  readonly onCommit: (description: string | undefined) => void;
}) {
  const id = useId();
  const field = useTyped(value);
  return (
    <PeerStackedField label="Description" htmlFor={id} aside={descriptionCount(field.shown)}>
      <Textarea
        id={id}
        value={field.shown}
        disabled={disabled}
        maxLength={DESCRIPTION_MAX}
        onChange={(event) => {
          field.type(event.target.value);
          onCommit(settledText(event.target.value));
        }}
        onBlur={field.leave}
      />
    </PeerStackedField>
  );
}

/**
 * What deleting the project takes with it, and the id to type before the delete button turns on.
 * Confirming does not delete anything yet: the page opens the review of the change, as for any
 * other save.
 */
export function DeleteProjectDialog({
  project,
  consequences,
  onConfirm,
  onClose,
}: {
  readonly project: { readonly id: string; readonly name: string };
  readonly consequences: ReadonlyArray<string>;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}) {
  const formId = useId();
  const [typed, setTyped] = useState("");
  const confirms = confirmsDeletion(typed, project.id);
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
            <DialogTitle>Delete {project.name}?</DialogTitle>
            <DialogDescription>This goes away for everyone:</DialogDescription>
          </div>
        </DialogHeader>
        <PeerDialogBody>
          <form
            id={formId}
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (confirms) onConfirm();
            }}
          >
            <ul className="flex list-disc flex-col gap-1.5 ps-5 text-sm text-foreground">
              {consequences.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <PeerStackedField
              label={
                <>
                  Type <code className="font-mono text-foreground">{project.id}</code> to confirm
                </>
              }
              htmlFor={`${formId}-confirm`}
            >
              <Input
                id={`${formId}-confirm`}
                font="mono"
                autoComplete="off"
                spellCheck={false}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
              />
            </PeerStackedField>
          </form>
        </PeerDialogBody>
        <PeerDialogFooter note="You review the change before it is saved.">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="destructive" disabled={!confirms}>
            Delete {project.name}
          </Button>
        </PeerDialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
