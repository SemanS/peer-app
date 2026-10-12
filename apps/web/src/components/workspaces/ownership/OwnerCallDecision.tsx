import type { EnvironmentId, PeerOwnerCall, PeerOwnershipDecision } from "@t3tools/contracts";
import { ShieldCheckIcon } from "lucide-react";
import { useId, useState } from "react";

import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
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
import { ownershipFailure } from "./failure";
import { NOTE_MAX, clampNote, decideInput, decisionCopy, noteLength } from "./ownerDecision.logic";

/**
 * The dialog that accepts or declines an owner's call, with a note for the asking agent that the
 * person may leave empty. The owner decides, or a lead for an owner who is away: the record then
 * says so, and so does the dialog. The Hub refuses what the person may not do (their own agent's
 * call, one that is no longer pending) and the dialog stays open with its reason. It is the one
 * dialog every place that shows a call uses: the board's card, the task's page, the Team page.
 */
export function OwnerCallDecision({
  environmentId,
  workspace,
  project,
  call,
  asker,
  owner,
  onBehalf,
  task,
  decision,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  /** The workspace's slug and the project's id. */
  readonly workspace: string;
  readonly project: string;
  readonly call: PeerOwnerCall;
  /** The person whose agent asked, and the owner it asked, by name. */
  readonly asker: string;
  readonly owner: string;
  /** The person decides for an owner who is away. */
  readonly onBehalf: boolean;
  /** The task it is about, as the lists write it ("ORD-9"); undefined for a call on no task. */
  readonly task: string | undefined;
  readonly decision: PeerOwnershipDecision;
  readonly onClose: () => void;
}) {
  const formId = useId();
  const decide = useAtomCommand(serverEnvironment.peerOwnership.decide, { reportFailure: false });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = decisionCopy({ decision, asker, owner, onBehalf, paths: call.paths, task });
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogPopup className="max-w-md">
        <PeerDialogHeader
          icon={ShieldCheckIcon}
          tone="needs"
          title={copy.title}
          description={copy.body}
        />
        <PeerDialogBody>
          <form
            id={formId}
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              setBusy(true);
              setError(null);
              void decide({
                environmentId,
                input: decideInput({ workspace, project, call, decision, note }),
              })
                .then((result) => {
                  const failure = ownershipFailure(result);
                  if (failure === null) onClose();
                  else setError(failure);
                })
                .finally(() => setBusy(false));
            }}
          >
            <PeerStackedField
              label={copy.noteLabel}
              htmlFor={`${formId}-note`}
              aside={`${noteLength(note)} / ${NOTE_MAX}`}
            >
              <Textarea
                id={`${formId}-note`}
                autoFocus
                value={note}
                disabled={busy}
                onChange={(event) => setNote(clampNote(event.target.value))}
              />
            </PeerStackedField>
            {copy.onBehalf === undefined ? null : <PeerFootnote>{copy.onBehalf}</PeerFootnote>}
            {error === null ? null : <PeerDialogMessage tone="error">{error}</PeerDialogMessage>}
          </form>
        </PeerDialogBody>
        <PeerDialogFooter>
          <DialogClose render={<Button variant="outline" disabled={busy} />}>Cancel</DialogClose>
          <Button
            type="submit"
            form={formId}
            variant={decision === "decline" ? "destructive-outline" : "default"}
            disabled={busy}
          >
            {busy ? copy.busy : copy.confirm}
          </Button>
        </PeerDialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
