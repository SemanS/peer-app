import { localCoordination } from "@t3tools/client-runtime/peer/local";
import type { PeerHubStatus } from "@t3tools/contracts";
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
}: {
  readonly status: PeerHubStatus;
  readonly scope?: ResolvedProjectScope;
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
  const visibleThreads = threads.toSorted(
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
      <section aria-label="Project chats" className="flex flex-col gap-2">
        <h2 className="font-semibold">Recent work</h2>
        {visibleThreads.length === 0 ? (
          <p role="status" className="text-muted-foreground">
            No chats here yet. Start a chat to work with an agent in this project.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {visibleThreads.slice(0, shown).map((thread) => (
              <li key={`${thread.environmentId}:${thread.id}`}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-start justify-between gap-3 rounded-md py-3 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
      {local.available ? (
        <>
          <p>
            {local.sessions.filter((session) => session.status === "working").length} running ·{" "}
            {local.overlaps.length} overlaps
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
                Overlap · {overlap.files.join(", ")}
              </summary>
              <div className="mt-2 flex flex-col gap-2 text-xs">
                <p>
                  {overlap.sessions
                    .map((id) => local.sessions.find((s) => s.id === id)?.label ?? id)
                    .join(" ↔ ")}
                </p>
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
      <div className="flex flex-wrap gap-2">
        <Button
          size="xs"
          variant="outline"
          onClick={() => void settings({ kind: "computer", section: "plugins" })}
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
