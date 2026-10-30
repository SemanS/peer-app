import { invitationView } from "@t3tools/client-runtime/peer-organizations";
import type { EnvironmentId, PeerHubStatus, PeerWorkspaceState } from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { serverEnvironment } from "../../../../state/server";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { Button } from "../../../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../../../ui/collapsible";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../../ui/select";
import { Sheet, SheetHeader, SheetPopup, SheetTitle, SheetDescription } from "../../../ui/sheet";
import { toastManager } from "../../../ui/toast";
import { MemberKeys } from "../../MemberKeys";
import { PeerDialogMessage } from "../../PeerDialog";
import { failureMessage, hubFailure } from "../../WorkspaceAccess";
import { limitActions, memberActions } from "../../workspaceMembers.logic";
import { ownershipFailure } from "../../ownership/failure";
import { isWorkspaceAdmin } from "../peerSettings.logic";
import { invitationActionRefusal } from "../workspacePeople.logic";
import { ProjectAccessFields, WorkChecklist } from "./AccessFields";
import {
  accessOf,
  accessText,
  limitOf,
  workChanges,
  workGroups,
  NO_WORK,
  type PersonRow,
  type ProjectAccess,
  type WorkPick,
} from "./people.logic";

type Role = "owner" | "admin" | "member";

/** What `email` owns in a project now, as the status's last view of its ownership says. */
function ownedWork(status: PeerHubStatus, slug: string, project: string, email: string): WorkPick {
  const view = status.ownership?.projects.find(
    (entry) => entry.workspace === slug && entry.project === project,
  );
  if (view === undefined) return NO_WORK;
  const mine = email.toLowerCase();
  return {
    areas: Object.entries(view.map.areas)
      .filter(([, owner]) => owner === mine)
      .map(([area]) => area),
    tasks: Object.values(view.tasks)
      .filter((row) => row.owner === mine)
      .map((row) => row.task),
  };
}

/**
 * Everything about one person in one place: their role, the projects they work in, the work they
 * own, an invitation still open, what stays out of the way under Advanced, and removing them. One
 * Save takes the role, the access and the work together, in that order: the Hub only lets someone
 * own work on a project they are on.
 */
export function PersonSheet({
  environmentId,
  status,
  workspace,
  person,
  now,
  onClose,
  onChanged,
  onRemove,
  onInviteBack,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly workspace: PeerWorkspaceState;
  readonly person: PersonRow;
  readonly now: number;
  readonly onClose: () => void;
  readonly onChanged: () => void;
  readonly onRemove: () => void;
  readonly onInviteBack: () => void;
}) {
  const member = person.member;
  const setRole = useAtomCommand(serverEnvironment.peerHubSetMemberRole, { reportFailure: false });
  const setProjects = useAtomCommand(serverEnvironment.peerHubSetMemberProjects, {
    reportFailure: false,
  });
  const setOwner = useAtomCommand(serverEnvironment.peerOwnership.setTaskOwner, {
    reportFailure: false,
  });
  const setMap = useAtomCommand(serverEnvironment.peerOwnership.setMap, { reportFailure: false });
  const resend = useAtomCommand(serverEnvironment.peerHubResendInvite, { reportFailure: false });
  const revoke = useAtomCommand(serverEnvironment.peerHubWithdrawInvite, { reportFailure: false });

  const projectName = (id: string) =>
    workspace.projects.find(({ project }) => project.id === id)?.project.name;
  const allProjects = workspace.projects.map(({ project }) => ({
    id: project.id,
    name: project.name,
  }));
  const actions =
    member === null
      ? null
      : memberActions(workspace.role, member.role, member.email === status.email);
  const limits = member === null ? null : limitActions({ workspace, member });

  const [role, setPickedRole] = useState<Role | null>(null);
  const [access, setAccess] = useState<ProjectAccess | null>(null);
  const chosenAccess = access ?? accessOf(member?.projects);
  const workProjects = allProjects.filter(
    (project) =>
      member !== null &&
      (member.role !== "member" ||
        chosenAccess.mode === "all" ||
        chosenAccess.projects.includes(project.id)) &&
      status.ownership?.projects.some(
        (entry) => entry.workspace === workspace.slug && entry.project === project.id,
      ),
  );
  const [picked, setPicked] = useState<string | null>(null);
  const project = workProjects.find((entry) => entry.id === picked) ?? workProjects[0] ?? null;
  const state = workspace.projects.find((entry) => entry.project.id === project?.id);
  const groups = state === undefined ? [] : workGroups(state.work);
  const before =
    project === null || member === null
      ? NO_WORK
      : ownedWork(status, workspace.slug, project.id, member.email);
  // Edits per project, so that moving between projects keeps what was ticked.
  const [edits, setEdits] = useState<Readonly<Record<string, WorkPick>>>({});
  const work = project === null ? NO_WORK : (edits[project.id] ?? before);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invitation = person.invitation;
  const inviteView = invitation === null ? null : invitationView(invitation, now);
  const dirty = role !== null || access !== null || Object.keys(edits).length > 0;
  const noProject = access?.mode === "selected" && access.projects.length === 0;
  const canManageWork =
    isWorkspaceAdmin(workspace.role) ||
    (project !== null &&
      workspace.projects.some(
        (entry) => entry.project.id === project.id && entry.project.role === "lead",
      ));

  const save = async () => {
    if (member === null) return;
    setBusy(true);
    setError(null);
    try {
      if (role !== null) {
        const failure = failureMessage(
          await setRole({
            environmentId,
            input: { workspace: workspace.slug, email: member.email, role },
          }),
        );
        if (failure !== null) return setError(failure);
      }
      if (access !== null) {
        const failure = failureMessage(
          await setProjects({
            environmentId,
            input: { workspace: workspace.slug, email: member.email, projects: limitOf(access) },
          }),
        );
        if (failure !== null) return setError(failure);
      }
      for (const [id, after] of Object.entries(edits)) {
        const owned = ownedWork(status, workspace.slug, id, member.email);
        const view = status.ownership?.projects.find(
          (entry) => entry.workspace === workspace.slug && entry.project === id,
        );
        const changes = workChanges({
          email: member.email.toLowerCase(),
          before: owned,
          after,
          areaOwners: view?.map.areas ?? {},
        });
        const owners = [
          ...changes.give.map((task) => ({ task, owner: member.email })),
          ...changes.takeBack.map((task) => ({ task, owner: null })),
        ];
        for (const { task, owner } of owners) {
          const failure = ownershipFailure(
            await setOwner({
              environmentId,
              input: { workspace: workspace.slug, project: id, task, owner },
            }),
          );
          if (failure !== null) return setError(failure);
        }
        if (changes.areas !== null && view !== undefined) {
          const failure = ownershipFailure(
            await setMap({
              environmentId,
              input: {
                workspace: workspace.slug,
                project: id,
                version: view.map.version,
                areas: changes.areas,
                paths: view.map.paths,
                decide: view.map.decide,
              },
            }),
          );
          if (failure !== null) return setError(failure);
        }
      }
      onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const answerInvitation = async (action: "resend" | "revoke") => {
    if (invitation === null) return;
    setBusy(true);
    setError(null);
    const input = { workspace: workspace.slug, email: invitation.email };
    const result = await (action === "resend"
      ? resend({ environmentId, input })
      : revoke({ environmentId, input }));
    setBusy(false);
    const failure = hubFailure(result);
    if (failure !== null) {
      setError(invitationActionRefusal(invitation.email, action, failure, false));
      return;
    }
    if (action === "resend")
      toastManager.add({
        type: "success",
        title: `Sent the invitation to ${invitation.email} again`,
      });
    onChanged();
    onClose();
  };

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <SheetPopup side="right" className="w-full max-w-lg">
        <SheetHeader>
          <SheetTitle>{person.name ?? person.email}</SheetTitle>
          <SheetDescription>
            {person.name === null ? person.summary : `${person.email} · ${person.summary}`}
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pb-6">
          {inviteView === null || invitation === null ? null : (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-foreground">Invitation</h3>
              <p className="text-sm text-muted-foreground">{inviteView.detail}</p>
              {inviteView.deliveryProblem === null ? null : (
                <p role="status" className="text-sm text-destructive">
                  {inviteView.deliveryProblem}
                </p>
              )}
              <div className="flex gap-2">
                {inviteView.canResend ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void answerInvitation("resend")}
                  >
                    Send again
                  </Button>
                ) : null}
                {inviteView.canRevoke ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void answerInvitation("revoke")}
                  >
                    Revoke invitation
                  </Button>
                ) : null}
              </div>
            </section>
          )}
          {person.removed === null ? null : (
            <section className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                An admin removed them. They can come back only with a new invitation.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="self-start"
                disabled={busy || person.removed.invited}
                onClick={onInviteBack}
              >
                {person.removed.invited ? "Invited back" : "Invite back"}
              </Button>
            </section>
          )}
          {member === null || actions === null || limits === null ? null : (
            <>
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-medium text-foreground">Role</h3>
                {actions.changeRole ? (
                  <Select
                    value={role ?? member.role}
                    disabled={busy}
                    onValueChange={(next) => {
                      if (next !== "owner" && next !== "admin" && next !== "member") return;
                      setPickedRole(next === member.role ? null : next);
                    }}
                  >
                    <SelectTrigger size="sm" aria-label={`Role of ${member.email}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {(workspace.role === "owner"
                        ? (["owner", "admin", "member"] as const)
                        : (["admin", "member"] as const)
                      ).map((value) => (
                        <SelectItem key={value} value={value}>
                          {`${value.charAt(0).toUpperCase()}${value.slice(1)}`}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {`${member.role.charAt(0).toUpperCase()}${member.role.slice(1)}`}
                  </p>
                )}
              </section>
              {limits.edit && (role ?? member.role) === "member" ? (
                <ProjectAccessFields
                  value={chosenAccess}
                  projects={allProjects}
                  disabled={busy}
                  onChange={setAccess}
                />
              ) : (
                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium text-foreground">Project access</h3>
                  <p className="text-sm text-muted-foreground">
                    {accessText(member.role === "member" ? member.projects : null, projectName)}
                  </p>
                  {limits.addTo.length === 0 ? null : (
                    <div className="flex flex-wrap gap-2">
                      {limits.addTo.map((entry) => (
                        <Button
                          key={entry.id}
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            setAccess({
                              mode: "selected",
                              projects: [...(member.projects ?? []), entry.id],
                            })
                          }
                        >
                          Add to {entry.name}
                        </Button>
                      ))}
                    </div>
                  )}
                </section>
              )}
              {project === null || !canManageWork ? null : (
                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium text-foreground">Assigned work</h3>
                  {workProjects.length > 1 ? (
                    <Select
                      value={project.id}
                      disabled={busy}
                      onValueChange={(next) => next !== null && setPicked(next)}
                    >
                      <SelectTrigger size="sm" aria-label="Project">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectPopup>
                        {workProjects.map((entry) => (
                          <SelectItem key={entry.id} value={entry.id}>
                            {entry.name}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  ) : (
                    <p className="text-sm text-muted-foreground">{project.name}</p>
                  )}
                  <WorkChecklist
                    groups={groups}
                    pick={work}
                    disabled={busy}
                    onChange={(next) => setEdits((current) => ({ ...current, [project.id]: next }))}
                  />
                </section>
              )}
              {isWorkspaceAdmin(workspace.role) ? (
                <Collapsible>
                  <CollapsibleTrigger
                    type="button"
                    className="group flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <ChevronRightIcon
                      aria-hidden
                      className="size-4 group-data-panel-open:rotate-90"
                    />
                    Advanced
                  </CollapsibleTrigger>
                  <CollapsiblePanel>
                    <div className="pt-2">
                      <MemberKeys
                        environmentId={environmentId}
                        workspace={workspace.slug}
                        email={member.email}
                      />
                    </div>
                  </CollapsiblePanel>
                </Collapsible>
              ) : null}
            </>
          )}
          {error === null ? null : <PeerDialogMessage tone="error">{error}</PeerDialogMessage>}
        </div>
        {member === null || actions === null ? null : (
          <div className="flex items-center justify-between gap-2 border-t border-border px-6 py-4">
            {actions.remove ? (
              <Button variant="destructive-outline" disabled={busy} onClick={onRemove}>
                Remove access
              </Button>
            ) : (
              <span />
            )}
            <Button disabled={busy || !dirty || noProject} onClick={() => void save()}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </div>
        )}
      </SheetPopup>
    </Sheet>
  );
}
