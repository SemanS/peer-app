import type { ProjectOwnership, TeamTask } from "@t3tools/client-runtime/peer/ownership";
import { UserCheckIcon } from "lucide-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import { randomUUID } from "../../../lib/utils";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { Dialog, DialogPopup } from "../../ui/dialog";
import { PeerDialogBody, PeerDialogFooter, PeerDialogHeader } from "../PeerDialog";
import { ownershipFailure } from "./failure";

/** Explicit selection and preview; existing task and area owners are never included. */
export function AssignUnassigned({
  environmentId,
  ownership,
  tasks,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly ownership: ProjectOwnership;
  readonly tasks: ReadonlyArray<TeamTask>;
  readonly onClose: () => void;
}) {
  const [selected, setSelected] = useState(
    () => new Set(tasks.filter((task) => task.owner === undefined).map((task) => task.id)),
  );
  const [owner, setOwner] = useState("");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [finished, setFinished] = useState(new Set<string>());
  const inFlight = useRef(false);
  const operations = useRef(new Map<string, string>());
  const latest = useRef({ tasks, ownership });
  useEffect(() => {
    latest.current = { tasks, ownership };
  }, [tasks, ownership]);
  const command = useAtomCommand(serverEnvironment.peerOwnership.setTaskOwner, {
    reportFailure: false,
  });
  const eligible = tasks.filter((task) => task.owner === undefined && !finished.has(task.id));
  const chosen = eligible.filter((task) => selected.has(task.id));
  const apply = async () => {
    if (inFlight.current || !owner || !ownership.canManage) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    let assigned = 0;
    let skipped = 0;
    try {
      for (const task of chosen) {
        const current = latest.current;
        if (!current.ownership.canManage || !current.ownership.people.has(owner)) {
          setMessage(
            `${assigned} assigned. Your access or the selected project member changed. Review the remaining tasks.`,
          );
          return;
        }
        const found = current.tasks.find((row) => row.id === task.id);
        if (found === undefined || found.owner !== undefined) {
          skipped += 1;
          continue;
        }
        const key = `${task.id}:${owner}`;
        const op = operations.current.get(key) ?? randomUUID();
        operations.current.set(key, op);
        const result = await command({
          environmentId,
          input: {
            workspace: ownership.workspace,
            project: ownership.project,
            task: task.id,
            owner,
            op,
          },
        });
        const failure =
          result._tag === "Success"
            ? null
            : (ownershipFailure(result) ??
              "Assignment was interrupted. Its outcome could not be confirmed.");
        if (failure !== null) {
          setMessage(
            `${assigned} assigned. ${failure} Review before retrying; completed assignments are retained.`,
          );
          return;
        }
        assigned += 1;
        setFinished((previous) => new Set([...previous, task.id]));
      }
      setMessage(
        `${assigned} ${assigned === 1 ? "task assigned" : "tasks assigned"} to ${ownership.people.get(owner) ?? owner}.${skipped > 0 ? ` ${skipped} skipped because they changed.` : ""}`,
      );
    } catch (error) {
      setMessage(
        `${assigned} assigned. The next assignment could not be confirmed: ${error instanceof Error ? error.message : String(error)}. Review before retrying.`,
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogPopup className="max-w-lg">
        <PeerDialogHeader
          icon={UserCheckIcon}
          title={preview ? "Review owner assignments" : "Assign unassigned tasks"}
          context="Only tasks with no task or area owner are eligible."
        />
        <PeerDialogBody>
          <label className="flex flex-col gap-2 text-sm">
            Assign to a project member
            <select
              value={owner}
              disabled={busy || preview}
              onChange={(event) => {
                setOwner(event.target.value);
                setMessage(null);
              }}
              className="min-h-11 rounded-md border border-input bg-background px-3 text-foreground"
            >
              <option value="">Choose a member</option>
              {[...ownership.people].map(([email, name]) => (
                <option key={email} value={email}>
                  {name} · {email}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm text-muted-foreground">
            {preview
              ? `${chosen.length} tasks will be assigned. Review every task before confirming.`
              : "Select the tasks to include. Existing owners are excluded. Eligibility is checked before each update; assignments are saved one at a time."}
          </p>
          <ul className="max-h-72 overflow-y-auto">
            {(preview ? chosen : eligible).map((task) => (
              <li key={task.id}>
                <label className="flex min-h-11 items-start gap-3 py-2 text-sm">
                  {!preview ? (
                    <input
                      type="checkbox"
                      checked={selected.has(task.id)}
                      disabled={busy}
                      onChange={(event) => {
                        setSelected((previous) => {
                          const next = new Set(previous);
                          if (event.target.checked) next.add(task.id);
                          else next.delete(task.id);
                          return next;
                        });
                      }}
                    />
                  ) : null}
                  <span className="min-w-0 wrap-anywhere">
                    {task.key ? `${task.key} · ` : ""}
                    {task.title}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {message === null ? null : (
            <p role="status" aria-live="polite" className="text-sm">
              {message}
            </p>
          )}
        </PeerDialogBody>
        <PeerDialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Close
          </Button>
          {preview ? (
            <Button variant="outline" disabled={busy} onClick={() => setPreview(false)}>
              Edit selection
            </Button>
          ) : null}
          <Button
            disabled={busy || !owner || chosen.length === 0}
            onClick={() => (preview ? void apply() : setPreview(true))}
          >
            {busy
              ? "Assigning…"
              : preview
                ? `Confirm ${chosen.length} assignments`
                : "Preview assignments"}
          </Button>
        </PeerDialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
