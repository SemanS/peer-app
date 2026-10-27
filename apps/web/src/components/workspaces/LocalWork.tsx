import { localCoordination } from "@t3tools/client-runtime/peer/local";
import { PEER_LOCAL_WORKSPACE, type PeerHubStatus } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { localThreadStatus } from "@t3tools/client-runtime/peer/work";
import { useThreadShells } from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";
import type { ResolvedProjectScope } from "./projectScope.logic";
import { chatScopeKeys } from "./projectScope.logic";
import { usePeerHubStatus } from "./WorkspaceAccess";
import { Button } from "../ui/button";
import { openHubSignIn } from "./HubSignInDialog";
import { useOpenPeerSettings } from "./settings/peerSettingsLinks";

/** Local work is scoped by the same repository refs as the chat list. */
export function LocalWork({
  status: fallbackStatus,
  scope,
  attention = false,
}: {
  readonly status: PeerHubStatus;
  readonly scope?: ResolvedProjectScope;
  readonly attention?: boolean;
}) {
  const targetEnvironment = scope?.refs?.[0]?.environmentId;
  const targetStatus = usePeerHubStatus(targetEnvironment ?? null);
  const status = targetStatus ?? fallbackStatus;
  const keys = chatScopeKeys(scope?.refs ?? null);
  const catalog = status.coordination.local?.projects;
  const projectIds =
    keys === null
      ? undefined
      : new Set(
          (catalog ?? [])
            .filter((project) => keys.has(`${status.environmentId}:${project.projectId}`))
            .map((project) => project.id),
        );
  const local = localCoordination(status, projectIds);
  const threads = useThreadShells().filter(
    (thread) =>
      thread.deletedAt === null &&
      thread.archivedAt === null &&
      thread.lineage.relationshipToParent !== "subagent" &&
      (keys === null
        ? thread.environmentId === status.environmentId
        : keys.has(`${thread.environmentId}:${thread.projectId}`)),
  );
  const visibleThreads = threads
    .filter((thread) => !attention || thread.hasPendingApprovals || thread.hasPendingUserInput)
    .toSorted(
      (a, b) =>
        Number(b.hasPendingApprovals || b.hasPendingUserInput) -
          Number(a.hasPendingApprovals || a.hasPendingUserInput) ||
        Number(localThreadStatus(b) === "working") - Number(localThreadStatus(a) === "working") ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
  const settings = useOpenPeerSettings();
  const navigate = useNavigate();
  const [shown, setShown] = useState(20);
  return (
    <section aria-label="Local coordination" className="flex flex-col gap-3 px-2 text-sm">
      <section
        aria-label={attention ? "Local decisions" : "Project chats"}
        className="flex flex-col gap-2"
      >
        <h2 className="font-semibold">{attention ? "Needs you" : "Recent work"}</h2>
        {visibleThreads.length === 0 ? (
          <p role="status" className="text-muted-foreground">
            {attention
              ? "You’re all caught up. No chat is waiting for your approval or answer."
              : "No chats here yet. Start a chat to work with an agent in this project."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {visibleThreads.slice(0, shown).map((thread) => (
              <li key={`${thread.environmentId}:${thread.id}`}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-start justify-between gap-3 rounded-md py-3 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() =>
                    void navigate({
                      to: "/$environmentId/$threadId",
                      params: buildThreadRouteParams(
                        scopeThreadRef(thread.environmentId, thread.id),
                      ),
                    })
                  }
                >
                  <span className="min-w-0 [overflow-wrap:anywhere]">{thread.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {thread.hasPendingApprovals
                      ? "Approve"
                      : thread.hasPendingUserInput
                        ? "Answer"
                        : localThreadStatus(thread) === "working"
                          ? "Running"
                          : "Open chat"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {visibleThreads.length > shown ? (
          <Button size="sm" variant="outline" onClick={() => setShown(shown + 20)}>
            More chats
          </Button>
        ) : null}
      </section>
      <h2 className="font-semibold">{local.title}</h2>
      <p className="text-muted-foreground">
        {targetEnvironment !== undefined && targetStatus === null
          ? "Connecting to this project’s environment…"
          : local.description}
      </p>
      {scope?.refs != null && catalog === undefined ? (
        <p className="text-sm text-muted-foreground">
          This environment cannot identify saved contexts by repository yet. Update it to see
          project-specific coordination here.
        </p>
      ) : null}
      {local.available ? (
        <>
          <p>
            {local.sessions.filter((session) => session.status === "working").length} running ·{" "}
            {local.open} open overlaps
          </p>
          <p className="text-xs text-muted-foreground">
            {local.providers
              .map(
                (provider) =>
                  `${provider.name}: ${provider.ready ? "hooks ready" : "setup needed or paused"}`,
              )
              .join(" · ")}
          </p>
          <p className="text-xs text-muted-foreground">
            Other providers can run chats; edit coordination requires a supported hook or MCP
            adapter.
          </p>
          {local.overlaps.slice(0, 8).map((overlap) => (
            <details key={overlap.id} className="rounded-md border p-3">
              <summary className="cursor-pointer font-medium">
                {overlap.state === "open" ? "Overlap detected" : "Overlap resolved"} ·{" "}
                {overlap.files.join(", ")}
              </summary>
              <div className="mt-2 flex flex-col gap-2 text-xs">
                <p>
                  {overlap.sessions
                    .map((id) => local.sessions.find((s) => s.id === id)?.label ?? id)
                    .join(" ↔ ")}
                </p>
                {overlap.resolution === undefined ? null : <p>{overlap.resolution}</p>}
                {overlap.notes.slice(-3).map((note) => (
                  <p key={note.id}>{note.text}</p>
                ))}
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    void navigate({
                      to: "/overlap/$workspace/$project/$overlap",
                      params: {
                        workspace: overlap.workspace,
                        project: overlap.project,
                        overlap: overlap.id,
                      },
                      search: { environmentId: targetEnvironment },
                    })
                  }
                >
                  Open coordination
                </Button>
              </div>
            </details>
          ))}
          {local.overlaps.length === 0 ? (
            <p className="text-muted-foreground">
              No overlaps recorded yet. Open a repository and start agents with Peer hooks enabled.
            </p>
          ) : null}
        </>
      ) : null}
      {local.projects.length === 0 ? null : (
        <section aria-label="Local shared contexts" className="flex flex-col gap-2">
          <h3 className="font-medium">
            Shared contexts · {local.projects.length}{" "}
            {local.projects.length === 1 ? "project" : "projects"}
          </h3>
          {local.projects.slice(0, shown).map((project) => (
            <div key={project.id} className="flex flex-col gap-1">
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void navigate({
                      to: "/context/$workspace/$project/$scope",
                      params: {
                        workspace: PEER_LOCAL_WORKSPACE,
                        project: project.id,
                        scope: "project-aggregate",
                      },
                      search: { environmentId: targetEnvironment },
                    })
                  }
                >
                  {project.name} · Shared context
                </Button>
              </div>
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Project details</summary>
                <p className="break-all">{project.id}</p>
              </details>
              <p className="text-xs text-muted-foreground">
                {project.contexts} saved contexts
                {project.gist === undefined ? "" : ` · ${project.gist}`}
              </p>
            </div>
          ))}
          {shown >= local.projects.length ? null : (
            <div>
              <Button size="xs" variant="outline" onClick={() => setShown(shown + 20)}>
                More projects · {local.projects.length - shown}
              </Button>
            </div>
          )}
        </section>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="xs"
          variant="outline"
          onClick={() => void settings({ kind: "computer", section: "coordination" })}
        >
          Coordination settings
        </Button>
        {!status.signedIn ? (
          <Button size="xs" variant="ghost-muted" onClick={openHubSignIn}>
            Connect a team Hub
          </Button>
        ) : null}
      </div>
    </section>
  );
}
