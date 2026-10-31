import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { needsByOpen } from "@t3tools/client-runtime/peer/work";
import type { EnvironmentId, PeerHubStatus, ScopedProjectRef } from "@t3tools/contracts";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { FileTextIcon, MessagesSquareIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "../ui/button";
import { SidebarMenu } from "../ui/sidebar";
import { ProjectHistory } from "./ProjectHistory";
import { ProjectSection } from "./ProjectSection";
import { SignalTiles } from "./ProjectSignals";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useThreadShells } from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";
import { chatScopeKeys, isLocalScope, type ResolvedProjectScope } from "./projectScope.logic";
import type { WorkActions } from "./useWorkActions";
import { ShareProject } from "./ShareProject";
import {
  NavRow,
  ProjectActivityNav,
  ProjectKnowledgeNav,
  WorkspaceActivityNav,
} from "./SidebarNav";
import type { SidebarTab } from "./SidebarViewSwitch.logic";
import { useLocalProject } from "./StableWorkNavigation";
import { useOpenScopedChats } from "./useOpenScopedChats";
import { sidebarNav } from "./sidebarNav.logic";
import { WorkSectionLabel, WorkHereContext } from "./marks";
import { ProjectMark, SignalCount } from "./signals";
import type { PeerWebPlugin } from "./slots.types";
import { useWorkData } from "./useWorkData";
import { WorkNoProjects } from "./WorkNoProjects";
import { ALL_PROJECTS, inScope, projectScopeKey } from "./workBoard.logic";
import { sharedRoomsOf } from "./rooms/sharedRoom.logic";

/**
 * The team's work in the sidebar, for the project the project button names (`scope`, which the root
 * checked against the projects there are). Each tab has a purpose of its own: Tasks is the work by
 * area, Knowledge what holds beyond one task, Activity what moved. With all projects, Tasks groups
 * the work under expandable project headings. A project no workspace shares has no team tasks, and
 * the view says so.
 */
export function WorkPanel({
  scope: resolved,
  tab,
}: {
  readonly scope: ResolvedProjectScope;
  readonly tab: SidebarTab;
}) {
  const { environmentId, status, plugins, tree, here, needs, actions, activeThread } =
    useWorkData();
  const scope = resolved.scope;
  const local = isLocalScope(scope);
  const current = tree.find((project) => projectScopeKey(project) === scope);
  const members = resolved.members;
  const listed =
    members === undefined
      ? tree
      : tree.filter((project) =>
          members.some((member) => member.scope === projectScopeKey(project)),
        );
  const counts = sidebarNav(
    tree.filter((project) => inScope(scope, project)),
    needs,
  );
  // What each of your waiting chats waits for, so a task's row tells an approval from an answer.
  const needOf = needsByOpen(needs);

  return (
    <WorkHereContext.Provider value={here}>
      <div className="flex flex-col gap-5 pb-6">
        {tab === "activity" && status?.signedIn === true ? (
          <WorkspaceActivityNav status={status} plugins={plugins} activeThread={activeThread} />
        ) : null}
        {tab !== "tasks" ? (
          environmentId === null || status === null ? (
            <p className="px-2 text-xs text-muted-foreground">Connecting…</p>
          ) : local ? (
            <LocalProjectTab scope={resolved} tab={tab} />
          ) : current === undefined ? (
            <p className="px-2 text-xs leading-relaxed text-muted-foreground">
              Choose one project to see its {tab === "knowledge" ? "knowledge" : "activity"}.
            </p>
          ) : tab === "knowledge" ? (
            <ProjectKnowledgeNav
              status={status}
              project={current}
              plugins={plugins}
              activeThread={activeThread}
              sharedContext={counts.sharedContext}
            />
          ) : (
            <section aria-label="Activity" className="flex flex-col gap-3">
              <ProjectActivityNav
                environmentId={environmentId}
                status={status}
                project={current}
                plugins={plugins}
                activeThread={activeThread}
              />
              <SignalTiles
                status={status}
                project={current}
                plugins={plugins}
                activeThread={activeThread}
                show={(signal) => signal.id === "overlaps"}
              />
              <ProjectHistory
                environmentId={environmentId}
                status={status}
                project={current}
                plugins={plugins}
                activeThread={activeThread}
              />
            </section>
          )
        ) : (
          <>
            {environmentId === null || status === null ? null : (
              <PluginSections environmentId={environmentId} status={status} plugins={plugins} />
            )}
            {environmentId === null || status === null ? (
              <p className="px-2 text-xs text-muted-foreground">Connecting…</p>
            ) : !status.signedIn ? (
              <LocalProjectNote />
            ) : local ? (
              <LocalProjectNote />
            ) : current === undefined && scope !== ALL_PROJECTS && members === undefined ? (
              <p className="px-2 text-xs leading-relaxed text-muted-foreground">
                No team tasks yet for this project.
              </p>
            ) : tree.length === 0 && members === undefined ? (
              status.workspaces.length === 0 ? (
                <p className="px-2 text-xs leading-relaxed text-muted-foreground">
                  Join or create a workspace in Settings → Peer to work with your team.
                </p>
              ) : (
                <WorkNoProjects
                  environmentId={environmentId}
                  status={status}
                  plugins={plugins}
                  fallback={
                    <p className="px-2 text-xs leading-relaxed text-muted-foreground">
                      No team projects yet. Share one below, and everyone in the workspace can work
                      on it.
                    </p>
                  }
                />
              )
            ) : current === undefined ? (
              <section aria-label="Projects" className="flex flex-col gap-1">
                {members === undefined ? null : (
                  <SharedRooms
                    rooms={sharedRoomsOf(
                      status,
                      members.map((member) => member.scope),
                    )}
                  />
                )}
                <WorkSectionLabel>
                  Projects
                  <span className="font-normal tracking-normal normal-case tabular-nums">
                    {listed.length}
                  </span>
                </WorkSectionLabel>
                {(
                  members ??
                  listed.map((project) => ({
                    scope: projectScopeKey(project),
                    name: project.name,
                    refs: null,
                  }))
                ).map((member) => {
                  const project = listed.find((node) => projectScopeKey(node) === member.scope);
                  return (
                    <ProjectDisclosure
                      key={member.scope}
                      name={member.name ?? member.scope}
                      colorKey={member.scope}
                      needs={project === undefined ? null : sidebarNav([project], needs).needs}
                      defaultOpen={members !== undefined}
                    >
                      {project === undefined ? (
                        <UnsharedProject
                          name={member.name ?? member.scope}
                          refs={member.refs ?? []}
                          status={status}
                          actions={actions}
                        />
                      ) : (
                        <ProjectSection
                          environmentId={environmentId}
                          status={status}
                          project={project}
                          plugins={plugins}
                          activeThread={activeThread}
                          actions={actions}
                          needOf={needOf}
                          heading={members !== undefined}
                        />
                      )}
                    </ProjectDisclosure>
                  );
                })}
              </section>
            ) : (
              <ProjectSection
                key={projectScopeKey(current)}
                environmentId={environmentId}
                status={status}
                project={current}
                plugins={plugins}
                activeThread={activeThread}
                actions={actions}
                needOf={needOf}
                heading
              />
            )}
            {environmentId !== null && status?.signedIn && status.workspaces.length > 0 ? (
              <ShareProject
                environmentId={environmentId}
                status={status}
                plugins={plugins}
                scope={resolved}
                actions={actions}
              />
            ) : null}
          </>
        )}
      </div>
    </WorkHereContext.Provider>
  );
}

/** What a project no workspace shares has under Knowledge and Activity. */
function LocalProjectTab({
  scope,
  tab,
}: {
  readonly scope: ResolvedProjectScope;
  readonly tab: SidebarTab;
}) {
  const navigate = useNavigate();
  const { context } = useLocalProject(scope);
  if (tab !== "knowledge" || context === undefined) {
    return (
      <p className="px-2 text-xs leading-relaxed text-muted-foreground">
        A project shared with a workspace keeps its {tab} here.
      </p>
    );
  }
  return (
    <SidebarMenu aria-label="Project knowledge">
      <NavRow
        icon={FileTextIcon}
        label="Project context"
        onClick={() => void navigate({ to: "/context/$workspace/$project/$scope", ...context })}
      />
    </SidebarMenu>
  );
}

/**
 * What plugins show above the project: the things that wait on the person which the board does not
 * list (tools to trust), and sections such as held resources. Each renders nothing while it has
 * nothing to say. Team requests are cards on the board, not here.
 */
function PluginSections({
  environmentId,
  status,
  plugins,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
}) {
  return (
    <>
      {plugins
        .filter((plugin) => plugin.id !== "requests")
        .map(({ id, needsYou }) =>
          needsYou?.Component === undefined ? null : (
            <needsYou.Component
              key={id}
              environmentId={environmentId}
              status={status}
              plugins={plugins}
            />
          ),
        )}
      {plugins
        .filter((plugin) => plugin.workPanelPlace === "after-overlaps")
        .map(({ id, workPanel: Section }) =>
          Section === undefined ? null : (
            <Section key={id} environmentId={environmentId} status={status} />
          ),
        )}
      {plugins
        .filter((plugin) => plugin.workPanelPlace !== "after-overlaps")
        .map(({ id, workPanel: Section }) =>
          Section === undefined ? null : (
            <Section key={id} environmentId={environmentId} status={status} />
          ),
        )}
    </>
  );
}

/** What the Tasks view says over a project that no workspace shares. */
function LocalProjectNote() {
  const openChats = useOpenScopedChats();
  const onWork = useLocation({ select: (location) => location.pathname === "/work" });
  if (onWork) return null;
  return (
    <div className="flex flex-col items-start gap-2 px-2 text-xs leading-relaxed text-muted-foreground">
      <p>Recent chats and coordination are in this project’s overview.</p>
      <Button size="xs" variant="outline" onClick={openChats}>
        Show its chats
      </Button>
    </div>
  );
}

function ProjectDisclosure({
  name,
  colorKey,
  children,
  needs,
  defaultOpen = false,
}: {
  readonly name: string;
  readonly colorKey: string;
  readonly children: ReactNode;
  readonly needs: number | null;
  /** A project set's projects stack open: their work is why they are grouped. */
  readonly defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="group/project"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 rounded-md px-2 py-2 text-sm font-medium outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <ProjectMark name={name} colorKey={colorKey} />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {needs === null ? null : <SignalCount tone="needs" count={needs} label="need you" />}
        <span aria-hidden className="text-muted-foreground group-open/project:rotate-90">
          ›
        </span>
      </summary>
      {open ? <div className="pl-2">{children}</div> : null}
    </details>
  );
}

/** A workspace's rooms across its projects, above each project's own work. */
function SharedRooms({
  rooms,
}: {
  readonly rooms: ReadonlyArray<{ readonly group: string; readonly title: string }>;
}) {
  if (rooms.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5 pb-2">
      <WorkSectionLabel>Rooms</WorkSectionLabel>
      {rooms.map((room) => (
        <Link
          key={room.group}
          to="/together/$group"
          params={{ group: room.group }}
          className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-sm text-foreground hover:bg-accent"
          activeProps={{ className: "bg-accent" }}
        >
          <MessagesSquareIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate">{room.title}</span>
        </Link>
      ))}
    </div>
  );
}

const UNSHARED_CHATS = 6;

/**
 * A workspace's project no Hub workspace shares: tasks and rooms live on the Hub, so it has its
 * chats here, a new one, and the way to its tasks.
 */
function UnsharedProject({
  name,
  refs,
  status,
  actions,
}: {
  readonly name: string;
  readonly refs: ReadonlyArray<ScopedProjectRef>;
  readonly status: PeerHubStatus;
  readonly actions: WorkActions;
}) {
  const keys = chatScopeKeys(refs);
  const chats = useThreadShells()
    .filter(
      (thread) =>
        thread.archivedAt === null &&
        thread.lineage.relationshipToParent !== "subagent" &&
        keys?.has(`${thread.environmentId}:${thread.projectId}`) === true,
    )
    .toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, UNSHARED_CHATS);
  const newThread = useNewThreadHandler();
  const ref = refs[0];
  return (
    <div className="flex flex-col gap-1 pb-2">
      <p className="px-2 py-0.5 text-xs text-muted-foreground">
        Only on this computer, so it has no tasks or rooms until you share it.
      </p>
      {chats.map((thread) => (
        <Link
          key={thread.id}
          to="/$environmentId/$threadId"
          params={buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id))}
          className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-sm text-foreground hover:bg-accent"
          activeProps={{ className: "bg-accent" }}
        >
          <MessagesSquareIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate">{thread.title}</span>
        </Link>
      ))}
      {ref === undefined ? null : (
        <div className="flex flex-wrap gap-1 px-2 pt-1">
          <Button size="xs" variant="outline" onClick={() => void newThread(ref)}>
            New chat
          </Button>
          {status.workspaces.map((workspace) => (
            <Button
              key={workspace.slug}
              size="xs"
              variant="outline"
              onClick={() =>
                void actions.shareProject(
                  { id: ref.projectId, environmentId: ref.environmentId },
                  name,
                  workspace,
                )
              }
            >
              Share with {workspace.name}…
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
