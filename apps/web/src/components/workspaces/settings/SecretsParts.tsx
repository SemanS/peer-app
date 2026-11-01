/**
 * The parts of the Secrets page (design artboard 18): the table of names with where each value
 * stands, and the two dialogs that change one: a value to store, and a deletion. A value goes to the
 * Hub and is never read back.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import { useId, useState } from "react";

import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button, InlineButton } from "../../ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogPopup, DialogTitle } from "../../ui/dialog";
import { Input } from "../../ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui/table";
import { toastManager } from "../../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import {
  PeerDialogBody,
  PeerDialogFooter,
  PeerDialogMessage,
  PeerStackedField,
} from "../PeerDialog";
import { failureMessage } from "../WorkspaceAccess";
import {
  SECRET_VALUE_MAX,
  VALUE_DIALOG_NOTE,
  deletedMessage,
  storedBy,
  storedMessage,
  valueText,
  type SecretRow,
} from "./secrets.logic";

function HeadLabel({ children }: { readonly children?: string }) {
  return (
    <span className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </span>
  );
}

/** Where a value stands. */
function ValueCell({ row }: { readonly row: SecretRow }) {
  const by = storedBy(row);
  const text = (
    <span className="flex items-center gap-2">
      <span aria-hidden className="size-2 rounded-full bg-success" />
      <span className="text-muted-foreground">{valueText(row)}</span>
    </span>
  );
  if (by === null) return text;
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} className="w-fit rounded-sm outline-none" />}>
        {text}
      </TooltipTrigger>
      <TooltipPopup side="top">{by}</TooltipPopup>
    </Tooltip>
  );
}

/** Every secret of the workspace: its name, where its value stands, and replacing or deleting it. */
export function SecretsTable({
  rows,
  onSet,
  onDelete,
}: {
  readonly rows: ReadonlyArray<SecretRow>;
  readonly onSet: (row: SecretRow) => void;
  readonly onDelete: (row: SecretRow) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <Table aria-label="Secrets">
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="w-1/3">
              <HeadLabel>Name</HeadLabel>
            </TableHead>
            <TableHead scope="col">
              <HeadLabel>Value</HeadLabel>
            </TableHead>
            <TableHead scope="col">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.name}>
              <TableCell>
                <span className="block max-w-64 truncate font-mono text-xs text-foreground">
                  {row.name}
                </span>
              </TableCell>
              <TableCell>
                <ValueCell row={row} />
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    aria-label={`Replace ${row.name}`}
                    onClick={() => onSet(row)}
                  >
                    Replace
                  </Button>
                  <InlineButton
                    tone="destructive"
                    aria-label={`Delete ${row.name}`}
                    onClick={() => onDelete(row)}
                  >
                    Delete
                  </InlineButton>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Stores a new value for a secret: the old is replaced, and never shown. The field hides what is typed. */
export function SecretValueDialog({
  environmentId,
  workspace,
  row,
  onSaved,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly row: SecretRow;
  readonly onSaved: () => void;
  readonly onClose: () => void;
}) {
  const put = useAtomCommand(serverEnvironment.peerSettings.putSecret, { reportFailure: false });
  const formId = useId();
  const fieldId = useId();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = value.trim();

  const save = () => {
    if (busy || trimmed === "") return;
    setBusy(true);
    setError(null);
    void put({ environmentId, input: { workspace, name: row.name, value: trimmed } })
      .then((result) => {
        const failure = failureMessage(result);
        if (failure !== null) {
          setError(failure);
          return;
        }
        if (result._tag !== "Success") return;
        toastManager.add({ type: "success", title: storedMessage(row.name) });
        onSaved();
        onClose();
      })
      .finally(() => setBusy(false));
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <div className="pe-6">
            <DialogTitle>Replace {row.name}</DialogTitle>
          </div>
          <DialogDescription>
            <span className="font-mono text-xs">{row.name}</span> · {VALUE_DIALOG_NOTE}
          </DialogDescription>
        </DialogHeader>
        <PeerDialogBody>
          <form
            id={formId}
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <PeerStackedField label="Value" htmlFor={fieldId}>
              <Input
                id={fieldId}
                type="password"
                autoComplete="off"
                autoFocus
                maxLength={SECRET_VALUE_MAX}
                placeholder="Paste the value"
                value={value}
                disabled={busy}
                onChange={(event) => setValue(event.target.value)}
              />
            </PeerStackedField>
          </form>
          {error === null ? null : <PeerDialogMessage tone="error">{error}</PeerDialogMessage>}
        </PeerDialogBody>
        <PeerDialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={busy || trimmed === ""}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </PeerDialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** Deletes a secret, after asking. */
export function DeleteSecretDialog({
  environmentId,
  workspace,
  row,
  onDeleted,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly row: SecretRow;
  readonly onDeleted: () => void;
  readonly onClose: () => void;
}) {
  const remove = useAtomCommand(serverEnvironment.peerSettings.deleteSecret, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void remove({ environmentId, input: { workspace, name: row.name } })
      .then((result) => {
        const failure = failureMessage(result);
        if (failure !== null) {
          setError(failure);
          return;
        }
        if (result._tag !== "Success") return;
        toastManager.add({ type: "success", title: deletedMessage(row.name) });
        onDeleted();
        onClose();
      })
      .finally(() => setBusy(false));
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <div className="pe-6">
            <DialogTitle>Delete {row.name}?</DialogTitle>
          </div>
          <DialogDescription>
            A deleted secret cannot be read back; set it again to use it.
          </DialogDescription>
        </DialogHeader>
        {error === null ? null : (
          <PeerDialogBody>
            <PeerDialogMessage tone="error">{error}</PeerDialogMessage>
          </PeerDialogBody>
        )}
        <PeerDialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy} onClick={confirm}>
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </PeerDialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
