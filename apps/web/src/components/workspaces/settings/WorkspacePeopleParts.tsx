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
import { toastManager } from "../../ui/toast";
import {
  PeerDialogBody,
  PeerDialogFooter,
  PeerDialogMessage,
  PeerStackedField,
} from "../PeerDialog";
import { hubFailure } from "../WorkspaceAccess";
import { inviter } from "../workspaceMembers.logic";
import { InviteWorkFields, ProjectAccessFields } from "./people/AccessFields";
import { NO_WORK, workGroups, type ProjectAccess, type WorkPick } from "./people/people.logic";
import {
  INVITE_LIMIT,
  INVITE_NOTE,
  INVITE_ROLES,
  inviteRefusal,
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

/**
 * Invites people in one form: who, their role, the projects they work in and, for one project, the
 * work they will own. Several addresses go one after the other; the ones the Hub refuses stay in
 * the field with the Hub's reason, the others are done. A lead who is no admin invites members to
 * the projects they lead, so names at least one; an admin may give every project instead.
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
  const choices = who?.projects ?? [];
  const [access, setAccess] = useState<ProjectAccess>(() => ({
    mode: "selected",
    projects: choices.length === 1 ? [choices[0]!.id] : [],
  }));
  const projects = role === "member" && access.mode === "selected" ? access.projects : [];
  const [entire, setEntire] = useState(true);
  const [pick, setPick] = useState<WorkPick>(NO_WORK);
  const onlyProject = projects.length === 1 ? projects[0] : undefined;
  const onlyState = workspace.projects.find(({ project }) => project.id === onlyProject);
  const groups = onlyState === undefined ? [] : workGroups(onlyState.work);
  const handed = entire || onlyProject === undefined ? NO_WORK : pick;
  const hasWork = handed.areas.length > 0 || handed.tasks.length > 0;
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<ReadonlyArray<{ address: string; message: string }>>([]);
  const addresses = parseAddresses(text);
  const tooMany = addresses.valid.length > INVITE_LIMIT;
  // Work goes to one person, and selected access names one project at least.
  const workForMany = hasWork && addresses.valid.length > 1;
  const needsProject = role === "member" && access.mode === "selected" && projects.length === 0;
  const ready =
    addresses.valid.length > 0 &&
    addresses.invalid.length === 0 &&
    !tooMany &&
    !workForMany &&
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
          ...(handed.areas.length === 0 ? {} : { areas: [...handed.areas] }),
          ...(handed.tasks.length === 0 ? {} : { tasks: [...handed.tasks] }),
        },
      });
      const failure = hubFailure(result);
      if (failure === null && result._tag === "Success") {
        invited.push(address);
        if (result.value.delivery?.state === "failed")
          toastManager.add({
            type: "error",
            title: `Invitation created, but could not email ${address}`,
            description: result.value.delivery.error ?? "Use Resend in Invitations to try again.",
          });
      } else
        failed.push({
          address,
          message:
            failure === null
              ? `Could not invite ${address}: the request was interrupted.`
              : inviteRefusal(address, failure),
        });
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
            <DialogTitle>Invite people</DialogTitle>
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
            <PeerStackedField label="Email address" htmlFor={fieldId}>
              <Input
                id={fieldId}
                type="text"
                autoFocus
                autoComplete="off"
                placeholder="name@company.com"
                value={text}
                disabled={busy}
                aria-invalid={addresses.invalid.length > 0 || tooMany}
                onChange={(event) => setText(event.target.value)}
              />
            </PeerStackedField>
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
                      className="flex cursor-pointer items-baseline gap-2.5 text-sm"
                    >
                      <Radio value={entry.id} className="translate-y-0.5" />
                      <span>
                        <span className="font-medium text-foreground">{entry.title}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          — {entry.description(workspace.name)}
                        </span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              </div>
            )}
            {role === "admin" || who === null ? null : (
              <ProjectAccessFields
                value={access}
                projects={choices}
                fixed={lead}
                disabled={busy}
                onChange={setAccess}
              />
            )}
            {onlyProject === undefined ? null : (
              <InviteWorkFields
                groups={groups}
                entire={entire}
                pick={pick}
                disabled={busy}
                onEntireChange={setEntire}
                onPickChange={setPick}
              />
            )}
            {projects.length > 1 ? (
              <p className="text-sm text-muted-foreground">
                Pick one project to assign tasks now. You can assign more on their page after they
                join.
              </p>
            ) : null}
            {workForMany ? (
              <PeerDialogMessage tone="error">
                Assigned work goes to one person. Invite one address with it.
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
                {entry.message}
              </PeerDialogMessage>
            ))}
          </form>
        </PeerDialogBody>
        <PeerDialogFooter note={INVITE_NOTE}>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={busy || !ready}>
            {busy ? "Sending…" : "Send invitation"}
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
