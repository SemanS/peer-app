import { PEER_ACCEPTANCE_LIMITS, type EnvironmentId } from "@t3tools/contracts";
import { BadgeCheckIcon, UndoIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { randomUUID } from "../../../lib/utils";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { withFinally } from "~/lib/withFinally";
import { Button } from "../../ui/button";
import { Dialog, DialogClose, DialogPopup } from "../../ui/dialog";
import { Textarea } from "../../ui/textarea";
import {
  PeerDialogBody,
  PeerDialogFooter,
  PeerDialogHeader,
  PeerDialogMessage,
  PeerFootnote,
  PeerStackedField,
} from "../PeerDialog";
import { failureMessage, usePeerHubStatus } from "../WorkspaceAccess";
import { acceptanceFacts, type AcceptanceFacts } from "./acceptance.logic";
import {
  closeAcceptanceDialog,
  useAcceptanceDialog,
  type AcceptanceDialogTarget,
} from "./acceptanceDialog";

/**
 * The plugin's background slot: the one place the accept and withdraw dialogs are mounted,
 * whichever menu, row or card opened them. It draws nothing until one is asked for.
 */
export function AcceptanceDialogs(_props: {
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
}) {
  const target = useAcceptanceDialog();
  if (target === null) return null;
  return (
    <AcceptanceDialogFor
      key={[target.kind, target.environmentId, target.workspace, target.project, target.task].join(
        "/",
      )}
      target={target}
    />
  );
}

const characters = (text: string) => [...text].length;

function AcceptanceDialogFor({ target }: { readonly target: AcceptanceDialogTarget }) {
  const status = usePeerHubStatus(target.environmentId);
  const facts = status === null ? undefined : acceptanceFacts(status, target);
  // The task is gone from under the dialog (the plugin turned off, the task was removed), or the
  // move it offers no longer applies: nothing is left to send.
  const gone = status !== null && (facts === undefined || !facts.actions.includes(target.kind));
  useEffect(() => {
    if (gone) closeAcceptanceDialog();
  }, [gone]);
  if (facts === undefined || gone) return null;
  return <NoteDialog target={target} facts={facts} />;
}

/** A lead accepts a delivered task, or withdraws an acceptance, with an optional note. */
function NoteDialog({
  target,
  facts,
}: {
  readonly target: AcceptanceDialogTarget;
  readonly facts: AcceptanceFacts;
}) {
  const formId = useId();
  const accepting = target.kind === "accept";
  const command = useAtomCommand(
    accepting ? serverEnvironment.peerAcceptanceAccept : serverEnvironment.peerAcceptanceWithdraw,
    { reportFailure: false },
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sent again after a lost reply, the same note keeps its op, so the Hub records it once.
  const operation = useRef<{ readonly note: string; readonly id: string } | null>(null);
  const trimmed = note.trim();
  const tooLong = characters(trimmed) > PEER_ACCEPTANCE_LIMITS.noteChars;
  const send = async () => {
    if (busy || tooLong) return;
    const pending =
      operation.current?.note === trimmed ? operation.current : { note: trimmed, id: randomUUID() };
    operation.current = pending;
    setBusy(true);
    setError(null);
    await withFinally(
      async () => {
        const result = await command({
          environmentId: target.environmentId,
          input: {
            ...facts.place,
            op: pending.id,
            ...(trimmed === "" ? {} : { note: trimmed }),
          },
        });
        const failure = failureMessage(result);
        if (failure === null) closeAcceptanceDialog();
        else setError(failure);
      },
      () => setBusy(false),
    );
  };
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) closeAcceptanceDialog();
      }}
    >
      <DialogPopup className="max-w-md">
        <PeerDialogHeader
          icon={accepting ? BadgeCheckIcon : UndoIcon}
          tone={accepting ? "delivery" : "neutral"}
          title={
            accepting ? `Accept ${facts.taskName}` : `Withdraw the acceptance of ${facts.taskName}`
          }
          context={
            <span className="min-w-0 truncate">
              {accepting
                ? facts.delivery === "review"
                  ? "In review: accepting it moves it to done as your move."
                  : "Done: it stays done and carries your acceptance."
                : `It stays ${facts.delivery}; the withdrawal is recorded with your note.`}
            </span>
          }
        />
        <PeerDialogBody>
          <form
            id={formId}
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <PeerStackedField
              label="Note"
              htmlFor={`${formId}-note`}
              aside={`${characters(trimmed)}/${PEER_ACCEPTANCE_LIMITS.noteChars}`}
              hint={accepting ? "Optional: what you checked." : "Optional: why you withdraw it."}
            >
              <Textarea
                id={`${formId}-note`}
                value={note}
                disabled={busy}
                onChange={(event) => {
                  setNote(event.target.value);
                  setError(null);
                }}
              />
            </PeerStackedField>
            <PeerFootnote>
              Acceptance is a fact on the task for whoever pays or reports. It stops no move.
            </PeerFootnote>
            {tooLong ? (
              <PeerDialogMessage tone="error">
                {`A note has at most ${PEER_ACCEPTANCE_LIMITS.noteChars} characters.`}
              </PeerDialogMessage>
            ) : null}
            {error === null ? null : <PeerDialogMessage tone="error">{error}</PeerDialogMessage>}
          </form>
        </PeerDialogBody>
        <PeerDialogFooter>
          <DialogClose render={<Button variant="outline" disabled={busy} />}>Cancel</DialogClose>
          <Button
            type="submit"
            form={formId}
            variant={accepting ? "default" : "destructive"}
            disabled={busy || tooLong}
          >
            {busy ? "Saving…" : accepting ? "Accept" : "Withdraw"}
          </Button>
        </PeerDialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
