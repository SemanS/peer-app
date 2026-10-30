import type { PeerRemovalPlan, PeerWorkspaceMembers } from "@t3tools/contracts";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import { serverEnvironment } from "../../../../state/server";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { useRelativeTimeTick } from "../../../settings/settingsLayout";
import { Button } from "../../../ui/button";
import { Input } from "../../../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../../ui/select";
import { stackedThreadToast, toastManager } from "../../../ui/toast";
import { failureMessage } from "../../WorkspaceAccess";
import { inviter } from "../../workspaceMembers.logic";
import type { WorkspacePageProps } from "../pageProps";
import { PersonSheet } from "../people/PersonSheet";
import {
  filterPeople,
  initials,
  noPeopleText,
  peopleRows,
  PEOPLE_FILTERS,
  type PeopleFilter,
  type PersonRow,
} from "../people/people.logic";
import { PeerSettingsPage } from "../PeerSettingsPage";
import { HostedWorkspaceSettings } from "../PluginSlots";
import { refusalText } from "../reviewChanges.logic";
import { useSettingsView } from "../useSettingsView";
import { InviteDialog, RemoveMemberDialog } from "../WorkspacePeopleParts";
import { useInvitations } from "../WorkspaceInvitations";
import {
  cleanupSets,
  projectsNaming,
  removalMessage,
  tookOutFailed,
  tookOutText,
  type NamingProject,
} from "../workspacePeople.logic";

type Member = PeerWorkspaceMembers["members"][number];

/** A removal waiting for the person's answer: who, and what the Hub says it does. */
interface Asking {
  readonly member: Member;
  readonly plan: PeerRemovalPlan;
}

/**
 * A workspace's People page: one list of everyone, where an invitation is a person's state. Opening
 * a person shows their role, access, work and removal in one place; Invite people asks for all of
 * it in one form. Owners, admins and leads manage; anyone else reads the list and is told who does.
 * The list follows every sync, so nothing here needs refreshing by hand.
 */
export function WorkspacePeople({ environmentId, status, workspace }: WorkspacePageProps) {
  const view = useSettingsView(workspace.slug);
  const invitations = useInvitations(environmentId, workspace.slug);
  const listed = invitations.data?.invitations ?? null;
  const members = useAtomCommand(serverEnvironment.peerHubMembers, { reportFailure: false });
  const preview = useAtomCommand(serverEnvironment.peerHubRemovalPlan, { reportFailure: false });
  const remove = useAtomCommand(serverEnvironment.peerHubRemoveMember, { reportFailure: false });
  const invite = useAtomCommand(serverEnvironment.peerHubInvite, { reportFailure: false });
  const save = useAtomCommand(serverEnvironment.peerSettings.save, { reportFailure: false });
  const [data, setData] = useState<PeerWorkspaceMembers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [openEmail, setOpenEmail] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<PeopleFilter>("all");
  const [asking, setAsking] = useState<Asking | null>(null);
  const now = useRelativeTimeTick(60_000);

  // Read when the page opens, after every sync, and after a change made here.
  const [reads, setReads] = useState(0);
  const readKey = `${environmentId}/${workspace.slug}/${status.lastSyncAt ?? ""}/${reads}`;
  const read = useEffectEvent((_key: string, current: () => boolean) => {
    void members({ environmentId, input: { workspace: workspace.slug } }).then((result) => {
      if (!current()) return;
      if (result._tag === "Success") {
        setData(result.value);
        setError(null);
      } else setError(failureMessage(result));
    });
  });
  useEffect(() => {
    let live = true;
    read(readKey, () => live);
    return () => {
      live = false;
    };
  }, [readKey]);
  const changed = () => {
    invitations.refresh();
    setReads((count) => count + 1);
  };

  const projectName = (id: string) =>
    workspace.projects.find(({ project }) => project.id === id)?.project.name;
  const nameOf = (member: Member) =>
    view.nameOf(member.name ? { email: member.email, name: member.name } : { email: member.email });
  const namingProjects = (member: Member, plan: PeerRemovalPlan): ReadonlyArray<NamingProject> =>
    projectsNaming({
      document: view.hubHasSettings ? view.document : null,
      email: member.email,
      planned: "unsupported" in plan ? [] : plan.projects,
      currency: workspace.currency,
      fallbackName: projectName,
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

  const startRemoval = async (member: Member) => {
    const plan = await preview({
      environmentId,
      input: { workspace: workspace.slug, email: member.email },
    });
    if (plan._tag !== "Success") {
      setError(failureMessage(plan));
      return;
    }
    if (!("unsupported" in plan.value) && !plan.value.canRemove) {
      setError(plan.value.reason ?? "This member cannot be removed.");
      return;
    }
    setOpenEmail(null);
    setAsking({ member, plan: plan.value });
  };

  const naming = asking === null ? [] : namingProjects(asking.member, asking.plan);
  const answerRemoval = async (ticked: ReadonlyArray<string> | null) => {
    if (asking === null) return;
    const { member } = asking;
    setAsking(null);
    if (ticked === null) return;
    const result = await remove({
      environmentId,
      input: { workspace: workspace.slug, email: member.email },
    });
    const failure = failureMessage(result);
    if (failure !== null) {
      setError(failure);
      return;
    }
    changed();
    await takeOut(
      member,
      naming.filter((project) => ticked.includes(project.id)),
    );
  };

  const inviteBack = async (email: string) => {
    const result = await invite({
      environmentId,
      input: { workspace: workspace.slug, email },
    });
    const failure = failureMessage(result);
    if (failure !== null) {
      setError(failure);
      return;
    }
    setOpenEmail(null);
    changed();
  };

  const rows = peopleRows({ members: data, invitations: listed, projectName, now });
  const shown = filterPeople(rows, search, filter);
  const open = rows.find((row) => row.email === openEmail) ?? null;
  const canInvite = inviter(workspace) !== null;

  return (
    <PeerSettingsPage
      title="People"
      description="Manage who works with you and what they can access."
      askLast
    >
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            className="min-w-48 flex-1"
            placeholder="Search people…"
            aria-label="Search people"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Select
            value={filter}
            onValueChange={(next) => {
              const found = PEOPLE_FILTERS.find((entry) => entry.id === next);
              if (found !== undefined) setFilter(found.id);
            }}
          >
            <SelectTrigger className="w-36" aria-label="Show">
              <SelectValue>
                {PEOPLE_FILTERS.find((entry) => entry.id === filter)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {PEOPLE_FILTERS.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          {canInvite ? (
            <Button aria-haspopup="dialog" onClick={() => setInviting(true)}>
              <PlusIcon aria-hidden className="size-4" />
              Invite people
            </Button>
          ) : null}
        </div>
        {canInvite ? null : (
          <p className="text-sm text-muted-foreground">
            {`Owners and admins of ${workspace.name} invite and remove people. Ask one of them.`}
          </p>
        )}
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {data === null && error === null ? (
          <p role="status" className="text-sm text-muted-foreground">
            Reading who is in {workspace.name}…
          </p>
        ) : null}
        {data !== null && shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">{noPeopleText(search, filter)}</p>
        ) : null}
        {shown.length === 0 ? null : (
          <ul className="divide-y divide-border/60">
            {shown.map((row) => (
              <li key={row.email}>
                <PersonRowButton row={row} onOpen={() => setOpenEmail(row.email)} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <HostedWorkspaceSettings
        host="people"
        environmentId={environmentId}
        status={status}
        workspace={workspace}
      />
      {open === null ? null : (
        <PersonSheet
          key={open.email}
          environmentId={environmentId}
          status={status}
          workspace={workspace}
          person={open}
          now={now}
          onClose={() => setOpenEmail(null)}
          onChanged={changed}
          onRemove={() => {
            if (open.member !== null) void startRemoval(open.member);
          }}
          onInviteBack={() => void inviteBack(open.email)}
        />
      )}
      {inviting ? (
        <InviteDialog
          environmentId={environmentId}
          workspace={workspace}
          onClose={() => setInviting(false)}
          onInvited={changed}
        />
      ) : null}
      {asking === null ? null : (
        <RemoveMemberDialog
          name={nameOf(asking.member)}
          workspaceName={workspace.name}
          plan={asking.plan}
          projects={naming}
          onConfirm={(ticked) => void answerRemoval(ticked)}
          onCancel={() => void answerRemoval(null)}
        />
      )}
    </PeerSettingsPage>
  );
}

function PersonRowButton({
  row,
  onOpen,
}: {
  readonly row: PersonRow;
  readonly onOpen: () => void;
}) {
  const waiting = row.state === "invited" || row.state === "expired";
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      className="flex w-full items-center gap-3 rounded-md py-3 text-start hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring"
      onClick={onOpen}
    >
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground"
      >
        {initials(row.name, row.email)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-foreground">{row.name ?? row.email}</span>
        <span className="truncate text-xs text-muted-foreground">{row.summary}</span>
      </span>
      <span
        className={waiting ? "text-xs text-warning-foreground" : "text-xs text-muted-foreground"}
      >
        {row.stateLabel}
      </span>
      <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
