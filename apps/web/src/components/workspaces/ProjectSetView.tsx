import type { CodeViewDiffItem } from "@pierre/diffs";
import { personName } from "@t3tools/client-runtime/peer/needs-you";
import { EnvironmentId, type PeerHubStatus } from "@t3tools/contracts";
import { Suspense, useState } from "react";

import { useSidebarProjectGroups } from "~/hooks/useSidebarProjectGroups";
import { useTheme } from "~/hooks/useTheme";
import {
  buildFileDiffContentVersion,
  buildFileDiffIdentityKey,
  getRenderablePatch,
  resolveDiffThemeName,
} from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { reviewEnvironment } from "../../state/review";
import { StyledDiffCodeView } from "../diffs/StyledDiffCodeView";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { PeerPageHeader } from "./PeerPageHeader";
import { useProjectScope } from "./projectScope";
import { isLocalScope, type ResolvedProjectScope } from "./projectScope.logic";
import {
  checkoutOf,
  setFolders,
  setOfScope,
  setScope,
  type ProjectCheckoutRef,
} from "./projectSets.logic";
import { useProjectSets } from "./projectSets";
import { ProjectAgents } from "./rooms/RoomAgents";
import { RoomFileSurface } from "./rooms/RoomFiles";
import { NewSharedRoom } from "./rooms/SharedRoomView";
import { ProjectMark } from "./signals";
import { useWorkData } from "./useWorkData";
import { projectScopeKey } from "./workBoard.logic";
import type { WorkOpen, WorkProjectNode } from "./workTree.logic";

const VIEWS = ["room", "files", "diff", "agents"] as const;
type View = (typeof VIEWS)[number];
const isView = (value: unknown): value is View => VIEWS.includes(value as View);

/**
 * A project set's projects side by side, one column each: their files, what changed in their
 * checkouts, or their agents. Columns scroll sideways rather than shrink past reading width.
 */
export function ProjectSetView({ setId }: { readonly setId: string }) {
  const groups = useSidebarProjectGroups();
  const [sets] = useProjectSets();
  const scope = useProjectScope(groups);
  const { environmentId, status, tree, actions } = useWorkData();
  const primary = usePrimaryEnvironmentId();
  const [view, setView] = useState<View>("room");
  const catalog = groups.flatMap((group) => group.memberProjects);
  const members = scope.scope === setScope(setId) ? scope.members : undefined;
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <PeerPageHeader page={scope.name ?? "Workspace"} />
        {members === undefined ? (
          <p className="px-6 py-6 text-sm text-muted-foreground">
            This workspace is no longer on this computer.
          </p>
        ) : (
          <>
            <div className="shrink-0 border-b border-border/60 px-4 py-2">
              <ToggleGroup
                aria-label="Show"
                value={[view]}
                onValueChange={(value) => {
                  if (isView(value[0])) setView(value[0]);
                }}
              >
                <Toggle value="room">Room</Toggle>
                <Toggle value="files">Files</Toggle>
                <Toggle value="diff">Diff</Toggle>
                <Toggle value="agents">Agents</Toggle>
              </ToggleGroup>
            </div>
            {view === "room" ? (
              environmentId === null || status === null ? null : (
                <NewSharedRoom
                  environmentId={environmentId}
                  status={status}
                  places={members.flatMap((member) => {
                    const [workspace, project] = member.scope.split("/");
                    return isLocalScope(member.scope) ||
                      workspace === undefined ||
                      project === undefined
                      ? []
                      : [{ workspace, project }];
                  })}
                  folders={setFolders(setOfScope(scope.scope, sets), groups)}
                />
              )
            ) : (
              <div className="flex min-h-0 min-w-0 flex-1 divide-x divide-border overflow-x-auto">
                {members.map((member) => (
                  <section
                    key={member.scope}
                    aria-label={member.name}
                    className="flex min-h-0 min-w-[24rem] flex-1 basis-0 flex-col"
                  >
                    <h2 className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2 text-sm font-medium text-foreground">
                      <ProjectMark
                        name={member.name ?? member.scope}
                        colorKey={member.scope}
                        className="size-4"
                      />
                      <span className="min-w-0 truncate">{member.name}</span>
                    </h2>
                    <Column
                      view={view}
                      member={member}
                      checkout={checkoutOf(member.refs ?? [], catalog, primary)}
                      project={tree.find((node) => projectScopeKey(node) === member.scope)}
                      status={status}
                      onOpen={actions.open}
                    />
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </SidebarInset>
  );
}

function Column({
  view,
  member,
  checkout,
  project,
  status,
  onOpen,
}: {
  readonly view: Exclude<View, "room">;
  readonly member: ResolvedProjectScope;
  readonly checkout: ProjectCheckoutRef | null;
  readonly project: WorkProjectNode | undefined;
  readonly status: PeerHubStatus | null;
  readonly onOpen: (open: WorkOpen) => void;
}) {
  if (view === "agents") {
    const state = status?.workspaces
      .flatMap((workspace) =>
        workspace.projects.filter(
          (candidate) =>
            workspace.slug === project?.workspace && candidate.project.id === project.projectId,
        ),
      )
      .at(0);
    if (project === undefined || state === undefined || !status?.email) {
      return <Note>Agents show here once the project is shared with your team.</Note>;
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
        <ProjectAgents
          project={project}
          me={status.email}
          nameOf={(email) => personName(state, email)}
          onOpen={onOpen}
        />
      </div>
    );
  }
  if (checkout === null) return <Note>This computer has no checkout of the project.</Note>;
  const environmentId = EnvironmentId.make(checkout.environmentId);
  return view === "files" ? (
    <Suspense fallback={null}>
      <RoomFileSurface
        key={checkout.cwd}
        environmentId={environmentId}
        folder={checkout.cwd}
        projectName={member.name ?? ""}
        revision=""
      />
    </Suspense>
  ) : (
    <ProjectChanges key={checkout.cwd} environmentId={environmentId} cwd={checkout.cwd} />
  );
}

/** What changed in a checkout: uncommitted work first, else its branch against its base. */
function ProjectChanges({
  environmentId,
  cwd,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
}) {
  const { resolvedTheme } = useTheme();
  const query = useEnvironmentQuery(
    reviewEnvironment.diffPreview({ environmentId, input: { cwd } }),
  );
  const source =
    query.data?.sources.find((candidate) => candidate.diff.trim() !== "") ?? query.data?.sources[0];
  const parsed = source === undefined ? null : getRenderablePatch(source.diff, `set-diff:${cwd}`);
  const items: CodeViewDiffItem<undefined>[] =
    parsed?.kind === "files"
      ? parsed.files.map((fileDiff) => ({
          id: buildFileDiffIdentityKey(fileDiff),
          type: "diff",
          fileDiff,
          version: buildFileDiffContentVersion(fileDiff),
        }))
      : [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-4 py-1.5">
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          {query.error ?? source?.title ?? "Reading the checkout…"}
        </p>
        <Button size="compact" variant="ghost-muted" onClick={query.refresh}>
          Refresh
        </Button>
      </div>
      {source?.truncated ? (
        <p role="status" className="shrink-0 px-4 py-1 text-xs text-warning-foreground">
          This diff was cut, so it ends early.
        </p>
      ) : null}
      {parsed === null ? (
        query.data === null ? null : (
          <Note>Nothing has changed here.</Note>
        )
      ) : parsed.kind === "raw" ? (
        <pre className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-xs whitespace-pre text-foreground">
          {parsed.text}
        </pre>
      ) : (
        <StyledDiffCodeView<undefined>
          className="@container min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]"
          items={items}
          options={{
            diffStyle: "unified",
            lineDiffType: "none",
            overflow: "wrap",
            theme: resolveDiffThemeName(resolvedTheme),
            preferredHighlighter: PREFERRED_HIGHLIGHTER,
            themeType: resolvedTheme,
            stickyHeaders: true,
          }}
        />
      )}
    </div>
  );
}

function Note({ children }: { readonly children: string }) {
  return <p className="px-4 py-5 text-sm text-muted-foreground">{children}</p>;
}
