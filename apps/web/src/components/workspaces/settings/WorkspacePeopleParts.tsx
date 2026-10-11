/**
 * The two dialogs of the People page: the invitation, with the role it gives (design artboard 15),
 * and the removal of a member, which asks whether to take them out of the projects that still name
 * them too (artboard 24). Neither decides anything: the Hub takes or refuses each invite and each
 * removal, and the page's settings save takes the person out of the ticked projects.
 */
import type { EnvironmentId, PeerRemovalPlan, PeerWorkspaceState } from "@t3tools/contracts";
import { useId, useState } from "react";

import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { Checkbox } from "../../ui/checkbox";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "../../ui/dialog";
import { Input } from "../../ui/input";
import { Radio, RadioGroup } from "../../ui/radio-group";
import { toastManager } from "../../ui/toast";
import {
  PeerDialogBody,
  PeerDialogFooter,
  PeerDialogMessage,
  PeerStackedField,
} from "../PeerDialog";
import { failureMessage } from "../WorkspaceAccess";
import {
  INVITE_LIMIT,
  INVITE_NOTE,
  INVITE_ROLES,
  inviteLabel,
  invalidText,
  invitedTitle,
  noLeadNote,
  parseAddresses,
  removalConsequences,
  removeLabel,
  stillNamedText,
  unchangeableText,
  type InviteRole,
  type NamingProject,
} from "./workspacePeople.logic";

/**
 * Invites people by address with a role (design artboard 15). Several addresses go one after the
 * other; the ones the Hub refuses stay in the field with the Hub's reason, the others are done.
 */
export function InviteDialog({
  environmentId,
  workspace,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: PeerWorkspaceState;
  readonly onClose: () => void;
}) {
  const invite = useAtomCommand(serverEnvironment.peerHubInvite, { reportFailure: false });
  const formId = useId();
  const fieldId = useId();
  const [text, setText] = useState("");
  const [role, setRole] = useState<InviteRole>("member");
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<ReadonlyArray<{ address: string; message: string }>>([]);
  const addresses = parseAddresses(text);
  const tooMany = addresses.valid.length > INVITE_LIMIT;
  const ready = addresses.valid.length > 0 && addresses.invalid.length === 0 && !tooMany;

  const submit = async () => {
    if (busy || !ready) return;
    setBusy(true);
    setRefused([]);
    const invited: string[] = [];
    const failed: Array<{ address: string; message: string }> = [];
    for (const address of addresses.valid) {
      const result = await invite({
        environmentId,
        input: { workspace: workspace.slug, email: address, role },
      });
      const failure = failureMessage(result);
      if (failure === null && result._tag === "Success") invited.push(address);
      else failed.push({ address, message: failure ?? "The request was interrupted." });
    }
    setBusy(false);
    if (invited.length > 0) {
      toastManager.add({ type: "success", title: invitedTitle(invited, role) });
    }
    if (failed.length === 0) {
      onClose();
      return;
    }
    setText(failed.map((entry) => entry.address).join(", "));
    setRefused(failed);
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
            <DialogTitle>Invite to {workspace.name}</DialogTitle>
          </div>
        </DialogHeader>
        <PeerDialogBody>
          <form
            id={formId}
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <PeerStackedField label="Email addresses" htmlFor={fieldId}>
              <Input
                id={fieldId}
                type="text"
                autoFocus
                autoComplete="off"
                placeholder="colleague@example.com"
                value={text}
                disabled={busy}
                aria-invalid={addresses.invalid.length > 0 || tooMany}
                onChange={(event) => setText(event.target.value)}
              />
            </PeerStackedField>
            <div className="flex flex-col gap-2">
              <span id={`${formId}-role`} className="text-sm font-medium text-foreground">
                Role
              </span>
              <RadioGroup
                aria-labelledby={`${formId}-role`}
                value={role}
                disabled={busy}
                onValueChange={(next) => setRole(next === "admin" ? "admin" : "member")}
              >
                {INVITE_ROLES.map((entry) => (
                  <label
                    key={entry.id}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-data-checked:border-ring has-data-checked:bg-accent/40"
                  >
                    <Radio value={entry.id} className="mt-0.5" />
                    <span className="flex min-w-0 flex-col">
                      <span className="text-sm font-medium text-foreground">{entry.title}</span>
                      <span className="text-sm text-muted-foreground">
                        {entry.description(workspace.name)}
                      </span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </div>
            {addresses.invalid.length === 0 ? null : (
              <PeerDialogMessage tone="error">{invalidText(addresses.invalid)}</PeerDialogMessage>
            )}
            {tooMany ? (
              <PeerDialogMessage tone="error">
                Invite up to {INVITE_LIMIT} people at a time.
              </PeerDialogMessage>
            ) : null}
            {refused.map((entry) => (
              <PeerDialogMessage key={entry.address} tone="error">
                Could not invite {entry.address}: {entry.message}
              </PeerDialogMessage>
            ))}
          </form>
        </PeerDialogBody>
        <PeerDialogFooter note={INVITE_NOTE}>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={busy || !ready}>
            {busy ? "Inviting…" : inviteLabel(role)}
          </Button>
        </PeerDialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/**
 * Asks before a member is removed (design artboard 24): what removal does, and, for the projects
 * that still name them, whether to take them out of those too. Those are ticked, since removing
 * someone and leaving them in a project is what the old confirmation left behind; the person unticks
 * what should stay. Confirming hands back the ticked projects.
 */
export function RemoveMemberDialog({
  name,
  workspaceName,
  plan,
  projects,
  onConfirm,
  onCancel,
}: {
  readonly name: string;
  readonly workspaceName: string;
  readonly plan: PeerRemovalPlan;
  /** Every project that still names them; the ones that can be changed here are ticked at first. */
  readonly projects: ReadonlyArray<NamingProject>;
  readonly onConfirm: (projectIds: ReadonlyArray<string>) => void;
  readonly onCancel: () => void;
}) {
  const editable = projects.filter((project) => project.editable);
  const fixed = projects.filter((project) => !project.editable);
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () => new Set(editable.map((project) => project.id)),
  );
  const chosen = editable.filter((project) => picked.has(project.id));
  const lonely = chosen.filter((project) => project.onlyLead);
  const toggle = (id: string, on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <div className="pe-6">
            <DialogTitle>
              Remove {name} from {workspaceName}?
            </DialogTitle>
          </div>
        </DialogHeader>
        <PeerDialogBody>
          <div className="flex flex-col gap-4">
            {editable.length === 0 ? null : (
              <fieldset className="flex flex-col gap-2.5">
                <legend className="pb-2 text-sm text-muted-foreground">
                  {stillNamedText(name, editable.length)}
                </legend>
                {editable.map((project) => (
                  <label
                    key={project.id}
                    className="flex cursor-pointer items-center gap-2.5 text-sm"
                  >
                    <Checkbox
                      checked={picked.has(project.id)}
                      onCheckedChange={(on) => toggle(project.id, on)}
                    />
                    <span className="text-foreground">
                      {project.name}{" "}
                      <span className="text-muted-foreground">· {project.detail}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            {lonely.map((project) => (
              <p key={project.id} className="text-sm text-muted-foreground">
                {noLeadNote(project.name, workspaceName)}
              </p>
            ))}
            {fixed.length === 0 ? null : (
              <p className="text-sm text-muted-foreground">
                {unchangeableText(
                  name,
                  fixed.map((project) => project.name),
                )}
              </p>
            )}
            <ul className="flex list-disc flex-col gap-1.5 ps-5 text-sm text-foreground">
              {removalConsequences({ name, workspaceName, plan }).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </PeerDialogBody>
        <PeerDialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(chosen.map((project) => project.id))}
          >
            {removeLabel(workspaceName, editable.length, chosen.length)}
          </Button>
        </PeerDialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
