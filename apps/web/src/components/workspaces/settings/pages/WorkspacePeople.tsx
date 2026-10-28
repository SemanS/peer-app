import type {
  EnvironmentId,
  PeerRemovalPlan,
  PeerWorkspaceMembers,
  PeerWorkspaceState,
} from "@t3tools/contracts";
import { useState } from "react";

import { serverEnvironment } from "../../../../state/server";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { SettingsRow, SettingsSection } from "../../../settings/settingsLayout";
import { stackedThreadToast, toastManager } from "../../../ui/toast";
import { failureMessage } from "../../WorkspaceAccess";
import { WorkspaceMembers } from "../../WorkspaceMembers";
import { inviter } from "../../workspaceMembers.logic";
import { InviteRow } from "../InviteRow";
import type { WorkspacePageProps } from "../pageProps";
import { isWorkspaceAdmin } from "../peerSettings.logic";
import { PeerSettingsPage } from "../PeerSettingsPage";
import { HostedWorkspaceSettings } from "../PluginSlots";
import { refusalText } from "../reviewChanges.logic";
import { useSettingsView } from "../useSettingsView";
import { RemoveMemberDialog } from "../WorkspacePeopleParts";
import { useInvitations, WorkspaceInvitations } from "../WorkspaceInvitations";
import {
  cleanupSets,
  projectsNaming,
  removalMessage,
  tookOutFailed,
  tookOutText,
  type NamingProject,
} from "../workspacePeople.logic";

type Member = PeerWorkspaceMembers["members"][number];

/** A removal waiting for the person's answer: who, what the Hub says it does, and how to answer. */
interface Asking {
  readonly member: Member;
  readonly plan: PeerRemovalPlan;
  readonly resolve: (afterRemoval: (() => Promise<void>) | null) => void;
}

/**
 * A workspace's People page. Owners and admins invite (with the role the invitation gives), change
 * roles and remove people with the rows the Workspaces page had; removing someone asks whether to
 * take them out of the projects that still name them, and does so in one settings save once the
 * removal went through. A project's lead invites members to the projects they lead and adds a
 * member limited to other projects to theirs. Everyone else is told who does.
 */
export function WorkspacePeople({ environmentId, status, workspace }: WorkspacePageProps) {
  return (
    <PeerSettingsPage title="People">
      <SettingsSection title="People" hideTitle>
        {isWorkspaceAdmin(workspace.role) ? (
          <PeopleOfAdmin environmentId={environmentId} email={status.email} workspace={workspace} />
        ) : inviter(workspace) !== null ? (
          <>
            <InviteRow environmentId={environmentId} workspace={workspace} />
            <WorkspaceMembers
              environmentId={environmentId}
              workspace={workspace}
              email={status.email}
              showInvites={false}
            />
          </>
        ) : (
          <SettingsRow
            title="Members"
            description={`Owners and admins of ${workspace.name} invite and remove people and change roles. Ask one of them.`}
          />
        )}
        <HostedWorkspaceSettings
          host="people"
          environmentId={environmentId}
          status={status}
          workspace={workspace}
        />
      </SettingsSection>
    </PeerSettingsPage>
  );
}

function PeopleOfAdmin({
  environmentId,
  email,
  workspace,
}: {
  readonly environmentId: EnvironmentId;
  readonly email: string | null;
  readonly workspace: PeerWorkspaceState;
}) {
  const view = useSettingsView(workspace.slug);
  const invitations = useInvitations(environmentId, workspace.slug);
  // A Hub that lists invitations with their states gets their own rows; an older one's pending
  // invitations stay in the members list.
  const listed = invitations.data?.invitations ?? null;
  const save = useAtomCommand(serverEnvironment.peerSettings.save, { reportFailure: false });
  const [asking, setAsking] = useState<Asking | null>(null);
  /** How the page calls a member: the name the settings give their address, else the Hub's. */
  const nameOf = (member: Member) =>
    view.nameOf(member.name ? { email: member.email, name: member.name } : { email: member.email });
  const fallbackName = (id: string) =>
    workspace.projects.find(({ project }) => project.id === id)?.project.name;
  const namingProjects = (member: Member, plan: PeerRemovalPlan): ReadonlyArray<NamingProject> =>
    projectsNaming({
      document: view.hubHasSettings ? view.document : null,
      email: member.email,
      planned: "unsupported" in plan ? [] : plan.projects,
      currency: workspace.currency,
      fallbackName,
    });

  /** Takes the person out of the ticked projects, once they are out of the workspace. */
  const takeOut = async (member: Member, projects: ReadonlyArray<NamingProject>) => {
    const name = nameOf(member);
    const document = view.document;
    const base = view.revision;
    const names = projects.map((project) => project.name);
    const tell = (reason: string) =>
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not update the projects",
          description: tookOutFailed(name, workspace.name, reason),
        }),
      );
    if (document === null || base === null) {
      tell("their settings could not be read.");
      return;
    }
    const set = cleanupSets(
      document,
      member.email,
      projects.map((project) => project.id),
    );
    if (set.length === 0) return;
    const result = await save({
      environmentId,
      input: {
        workspace: workspace.slug,
        base,
        set,
        message: removalMessage(name, workspace.name),
      },
    });
    const failure = failureMessage(result);
    if (failure !== null) {
      tell(failure);
      return;
    }
    if (result._tag !== "Success") return;
    const answer = result.value;
    switch (answer.kind) {
      case "saved":
        toastManager.add({ type: "success", title: tookOutText(name, names) });
        view.refresh();
        return;
      case "conflict":
        tell("they changed meanwhile. Take them out in each project’s People tab.");
        return;
      case "forbidden":
        tell(answer.refused.map(refusalText).join(" "));
        return;
      case "invalid":
        tell(answer.diagnostics[0]?.message ?? "the settings do not check out.");
        return;
      case "preview":
        return;
    }
  };

  const confirmRemoval = (member: Member, plan: PeerRemovalPlan) =>
    new Promise<(() => Promise<void>) | null>((resolve) => setAsking({ member, plan, resolve }));

  const projects = asking === null ? [] : namingProjects(asking.member, asking.plan);
  const answer = (ticked: ReadonlyArray<string> | null) => {
    if (asking === null) return;
    const { member, resolve } = asking;
    setAsking(null);
    if (ticked === null) {
      resolve(null);
      return;
    }
    const chosen = projects.filter((project) => ticked.includes(project.id));
    resolve(chosen.length === 0 ? async () => {} : () => takeOut(member, chosen));
  };

  return (
    <>
      <InviteRow
        environmentId={environmentId}
        workspace={workspace}
        onInvited={invitations.refresh}
      />
      {listed === null ? null : (
        <WorkspaceInvitations
          environmentId={environmentId}
          workspace={workspace}
          invitations={listed}
          onChanged={invitations.refresh}
        />
      )}
      <WorkspaceMembers
        environmentId={environmentId}
        workspace={workspace}
        email={email}
        confirmRemoval={confirmRemoval}
        showInvites={listed === null}
        onInvited={invitations.refresh}
      />
      {asking === null ? null : (
        <RemoveMemberDialog
          name={nameOf(asking.member)}
          workspaceName={workspace.name}
          plan={asking.plan}
          projects={projects}
          onConfirm={answer}
          onCancel={() => answer(null)}
        />
      )}
    </>
  );
}
