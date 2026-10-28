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
import { useInvitePreviews } from "./useInvitePreviews";
import { Button } from "../../ui/button";
import { Checkbox } from "../../ui/checkbox";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "../../ui/dialog";
import { Input } from "../../ui/input";
import { Radio, RadioGroup } from "../../ui/radio-group";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { toastManager } from "../../ui/toast";
import {
  PeerDialogBody,
  PeerDialogFooter,
  PeerDialogMessage,
  PeerStackedField,
} from "../PeerDialog";
import { failureMessage } from "../WorkspaceAccess";
import { inviter, inviteTaskChoices } from "../workspaceMembers.logic";
import {
  INVITE_LIMIT,
  INVITE_NOTE,
  INVITE_ROLES,
  inviteLabel,
  invalidText,
  invitedTitle,
  inviteReach,
  noLeadNote,
  parseAddresses,
  removalConsequences,
  removeLabel,
  stillNamedText,
  unchangeableText,
  type InviteRole,
  type NamingProject,
} from "./workspacePeople.logic";

/** The task select's choice for an invitation that hands over no task. */
const NO_TASK = "none";

/**
 * Invites people by address with a role (design artboard 15). Several addresses go one after the
 * other; the ones the Hub refuses stay in the field with the Hub's reason, the others are done.
 * The invitation may name projects, which the person will be on and no other, and one of their
 * tasks that waits for them. A lead who is no admin invites members to the projects they lead, so
 * names at least one; an admin who names none invites to the whole workspace, as before.
 */
export function InviteDialog({
  environmentId,
  workspace,
  onClose,
  onInvited,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: PeerWorkspaceState;
  readonly onClose: () => void;
  readonly onInvited?: () => void;
}) {
  const invite = useAtomCommand(serverEnvironment.peerHubInvite, { reportFailure: false });
  const formId = useId();
  const fieldId = useId();
  const [text, setText] = useState("");
  const [role, setRole] = useState<InviteRole>("member");
  const who = inviter(workspace);
  const lead = who?.as === "lead";
  const [projects, setProjects] = useState<ReadonlyArray<string>>(() =>
    lead && who.projects.length === 1 ? who.projects.map((project) => project.id) : [],
  );
  const [task, setTask] = useState<string | null>(null);
  const tasks = inviteTaskChoices(workspace, projects);
  const chosenTask = tasks.some((choice) => choice.id === task) ? task : null;
  const toggleProject = (id: string, on: boolean) =>
    setProjects((current) =>
      on
        ? [...current.filter((entry) => entry !== id), id]
        : current.filter((entry) => entry !== id),
    );
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<ReadonlyArray<{ address: string; message: string }>>([]);
  const addresses = parseAddresses(text);
  const tooMany = addresses.valid.length > INVITE_LIMIT;
  // A task goes to one person, and a lead's invitation names one of their projects at least.
  const taskForMany = chosenTask !== null && addresses.valid.length > 1;
  const needsProject = lead && projects.length === 0;
  const ready =
    addresses.valid.length > 0 &&
    addresses.invalid.length === 0 &&
    !tooMany &&
    !taskForMany &&
    !needsProject;
  const previews = useInvitePreviews(
    environmentId,
    workspace.slug,
    ready ? addresses.valid : [],
    projects,
  );
  const reaches = previews
    .filter((preview) =>
      addresses.valid.some((email) => email.toLowerCase() === preview.email.toLowerCase()),
    )
    .map((preview) => ({ email: preview.email, ...inviteReach(preview, workspace.name) }));

  const submit = async () => {
    if (busy || !ready) return;
    setBusy(true);
    setRefused([]);
    const invited: string[] = [];
    const failed: Array<{ address: string; message: string }> = [];
    for (const address of addresses.valid) {
      const result = await invite({
        environmentId,
        input: {
          workspace: workspace.slug,
          email: address,
          role: lead ? "member" : role,
          ...(projects.length === 0 ? {} : { projects: [...projects] }),
          ...(chosenTask === null ? {} : { task: chosenTask }),
        },
      });
      const failure = failureMessage(result);
      if (failure === null && result._tag === "Success") {
        invited.push(address);
        if (result.value.delivery?.state === "failed")
          toastManager.add({
            type: "error",
            title: `Invitation created, but could not email ${address}`,
            description: result.value.delivery.error ?? "Use Resend in Invitations to try again.",
          });
      } else failed.push({ address, message: failure ?? "The request was interrupted." });
    }
    setBusy(false);
    if (invited.length > 0) {
      toastManager.add({ type: "success", title: invitedTitle(invited, role) });
      onInvited?.();
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
            {who === null || who.projects.length === 0 ? null : (
              <fieldset className="flex flex-col gap-2.5">
                <legend className="pb-2 text-sm font-medium text-foreground">Projects</legend>
                <p className="text-sm text-muted-foreground">
                  {lead
                    ? "They will be on the projects you tick, and no other."
                    : "They will be on the projects you tick, and no other. Tick none to invite them to the whole workspace."}
                </p>
                {who.projects.map((project) => (
                  <label
                    key={project.id}
                    className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground"
                  >
                    <Checkbox
                      checked={projects.includes(project.id)}
                      disabled={busy}
                      onCheckedChange={(on) => toggleProject(project.id, on)}
                    />
                    {project.name}
                  </label>
                ))}
              </fieldset>
            )}
            {projects.length === 0 || tasks.length === 0 ? null : (
              <div className="flex flex-col gap-2">
                <span id={`${formId}-task`} className="text-sm font-medium text-foreground">
                  Task
                </span>
                <Select
                  value={chosenTask ?? NO_TASK}
                  disabled={busy}
                  onValueChange={(value) =>
                    setTask(value === null || value === NO_TASK ? null : value)
                  }
                >
                  <SelectTrigger size="sm" aria-labelledby={`${formId}-task`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value={NO_TASK}>No task</SelectItem>
                    {tasks.map((choice) => (
                      <SelectItem key={choice.id} value={choice.id}>
                        {choice.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <span className="text-sm text-muted-foreground">
                  It becomes theirs when they join, unless somebody else owns it by then.
                </span>
              </div>
            )}
            {lead ? null : (
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
            )}
            {taskForMany ? (
              <PeerDialogMessage tone="error">
                A task goes to one person. Invite one address with it.
              </PeerDialogMessage>
            ) : null}
            {reaches.map((reach) => (
              <div
                key={reach.email}
                role="status"
                className="flex flex-col gap-1 text-sm text-muted-foreground"
              >
                <p className="text-foreground">{reach.email}</p>
                {reach.person === null ? null : <p>{reach.person}</p>}
                {/* With projects named, what the workspace would open to them does not apply. */}
                {projects.length > 0 ? null : <p>{reach.projects}</p>}
                {projects.length > 0 || reach.restricted === null ? null : (
                  <p>{reach.restricted}</p>
                )}
                {reach.capacity === null ? null : <p>{reach.capacity}</p>}
                {reach.overLimit === null ? null : (
                  <PeerDialogMessage tone="error">{reach.overLimit}</PeerDialogMessage>
                )}
              </div>
            ))}
            {reaches.length > 1 ? (
              <p className="text-sm text-muted-foreground">
                These previews apply to each person separately. The Hub checks available capacity
                when each person joins.
              </p>
            ) : null}
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
