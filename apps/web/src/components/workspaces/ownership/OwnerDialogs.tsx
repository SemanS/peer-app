import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { HandshakeIcon, UserCheckIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { randomUUID } from "../../../lib/utils";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { Dialog, DialogClose, DialogPopup } from "../../ui/dialog";
import {
  PeerDialogBody,
  PeerDialogFooter,
  PeerDialogHeader,
  PeerDialogMessage,
  PeerFootnote,
} from "../PeerDialog";
import { usePeerHubStatus } from "../WorkspaceAccess";
import { ownershipFailure } from "./failure";
import { closeOwnerDialog, useOwnerDialog, type OwnerDialogTarget } from "./ownerDialog";
import {
  currentOwnerWords,
  handOverCandidateLine,
  handOverNotes,
  ownerCandidates,
  setOwnerConfirm,
  setOwnerExplanation,
  taskName,
  taskOwnerFacts,
  type TaskOwnerFacts,
} from "./ownership.logic";
import { NO_OWNER, OwnerPicker } from "./OwnerPicker";
import { withFinally } from "~/lib/withFinally";

/**
 * The plugin's background slot: the one place the owner dialogs are mounted, whichever menu opened
 * them (the task's page, the sidebar's row). It draws nothing until a menu asks for one.
 */
export function OwnerDialogs(_props: { readonly environmentIds: ReadonlyArray<EnvironmentId> }) {
  const target = useOwnerDialog();
  if (target === null) return null;
  return (
    <OwnerDialogFor
      key={[target.kind, target.environmentId, target.workspace, target.project, target.task].join(
        "/",
      )}
      target={target}
    />
  );
}

/** The dialog for a task, read from the status as it is while the dialog is open. */
function OwnerDialogFor({ target }: { readonly target: OwnerDialogTarget }) {
  const status = usePeerHubStatus(target.environmentId);
  const facts = status === null ? undefined : taskOwnerFacts(status, target);
  // The task or its ownership is gone from under the dialog (the plugin turned off, the task was
  // removed): nothing is left to change.
  const gone = status !== null && facts === undefined;
  useEffect(() => {
    if (gone) closeOwnerDialog();
  }, [gone]);
  if (status === null || facts === undefined) return null;
  return target.kind === "set" ? (
    <SetOwnerDialog environmentId={target.environmentId} status={status} facts={facts} />
  ) : (
    <HandOverDialog environmentId={target.environmentId} status={status} facts={facts} />
  );
}

/**
 * Sends the change of a task's owner, and keeps its operation stable while the person retries it
 * after a lost reply: choosing someone else starts a new one.
 */
function useChangeOwner(environmentId: EnvironmentId, facts: TaskOwnerFacts) {
  const command = useAtomCommand(serverEnvironment.peerOwnership.setTaskOwner, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef<{ readonly draft: string; readonly id: string } | null>(null);
  const { workspace, ownership, task } = facts;
  const change = async (owner: string | null) => {
    if (busy) return;
    const draft = JSON.stringify([task.id, owner]);
    const pending =
      operation.current?.draft === draft ? operation.current : { draft, id: randomUUID() };
    operation.current = pending;
    setBusy(true);
    setError(null);
    await withFinally(
      async () => {
        const result = await command({
          environmentId,
          input: {
            workspace: workspace.slug,
            project: ownership.project,
            task: task.id,
            owner,
            op: pending.id,
          },
        });
        const failure = ownershipFailure(result);
        if (failure === null) closeOwnerDialog();
        else setError(failure);
      },
      () => {
        setBusy(false);
      },
    );
  };
  return { busy, error, change, clearError: () => setError(null) };
}

/** A lead or an admin names a task's owner, or takes it away. */
function SetOwnerDialog({
  environmentId,
  status,
  facts,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly facts: TaskOwnerFacts;
}) {
  const formId = useId();
  const { task, owner } = facts;
  // A task owned through its area has no owner of its own to start from.
  const current = owner === undefined || owner.throughArea !== undefined ? NO_OWNER : owner.email;
  const [picked, setPicked] = useState(current);
  const [query, setQuery] = useState("");
  const { busy, error, change, clearError } = useChangeOwner(environmentId, facts);
  const options = ownerCandidates(facts, status, { query });
  const pick =
    picked === NO_OWNER
      ? null
      : (ownerCandidates(facts, status).find((candidate) => candidate.email === picked) ?? null);
  const unchanged = picked === current;
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) closeOwnerDialog();
      }}
    >
      <DialogPopup className="max-w-md">
        <PeerDialogHeader
          icon={UserCheckIcon}
          tone="team"
          title={`Set the owner of ${taskName(task)}`}
          context={
            <span className="min-w-0 truncate">
              {task.key === undefined ? null : `${task.title} · `}
              {currentOwnerWords(owner)}
            </span>
          }
        />
        <PeerDialogBody>
          <form
            id={formId}
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!unchanged) void change(picked === NO_OWNER ? null : picked);
            }}
          >
            <OwnerPicker
              id={`${formId}-find`}
              label="Find a project member"
              query={query}
              onQueryChange={setQuery}
              options={options}
              value={picked}
              onChange={(next) => {
                setPicked(next);
                clearError();
              }}
              offerNone
              disabled={busy}
              describe={(candidate) => candidate.note}
            />
            {unchanged ? null : <PeerFootnote>{setOwnerExplanation(pick, task)}</PeerFootnote>}
            {error === null ? null : <PeerDialogMessage tone="error">{error}</PeerDialogMessage>}
          </form>
        </PeerDialogBody>
        <PeerDialogFooter>
          <DialogClose render={<Button variant="outline" disabled={busy} />}>Cancel</DialogClose>
          <Button type="submit" form={formId} disabled={busy || unchanged}>
            {busy ? "Saving…" : setOwnerConfirm(pick)}
          </Button>
        </PeerDialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** A task's owner passes it to another member of the project. */
function HandOverDialog({
  environmentId,
  status,
  facts,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly facts: TaskOwnerFacts;
}) {
  const formId = useId();
  const { task, ownership } = facts;
  const [picked, setPicked] = useState("");
  const [query, setQuery] = useState("");
  const { busy, error, change, clearError } = useChangeOwner(environmentId, facts);
  const leaveOut = ownership.me === null ? [] : [ownership.me];
  const options = ownerCandidates(facts, status, { query, leaveOut });
  const pick =
    ownerCandidates(facts, status, { leaveOut }).find((candidate) => candidate.email === picked) ??
    null;
  // Read at render, like the board's labels: a pending call is a fact of the moment.
  const [now] = useState(() => Date.now());
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) closeOwnerDialog();
      }}
    >
      <DialogPopup className="max-w-md">
        <PeerDialogHeader
          icon={HandshakeIcon}
          tone="team"
          title={`Hand over ${taskName(task)}`}
          context={
            <span className="min-w-0 truncate">
              {task.key === undefined ? null : `${task.title} · `}you own it
            </span>
          }
        />
        <PeerDialogBody>
          <form
            id={formId}
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (pick !== null) void change(pick.email);
            }}
          >
            <OwnerPicker
              id={`${formId}-find`}
              label="New owner"
              query={query}
              onQueryChange={setQuery}
              options={options}
              value={picked}
              onChange={(next) => {
                setPicked(next);
                clearError();
              }}
              offerNone={false}
              disabled={busy}
              describe={handOverCandidateLine}
            />
            {pick === null ? null : (
              <div className="flex flex-col gap-1.5 rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
                {handOverNotes({ facts, status, pick, now }).map((note) => (
                  <p key={note}>{note}</p>
                ))}
              </div>
            )}
            {error === null ? null : <PeerDialogMessage tone="error">{error}</PeerDialogMessage>}
          </form>
        </PeerDialogBody>
        <PeerDialogFooter>
          <DialogClose render={<Button variant="outline" disabled={busy} />}>Cancel</DialogClose>
          <Button type="submit" form={formId} disabled={busy || pick === null}>
            {busy ? "Handing over…" : pick === null ? "Hand over" : `Hand over to ${pick.name}`}
          </Button>
        </PeerDialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
