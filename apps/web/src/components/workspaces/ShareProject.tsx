import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import type { EnvironmentId, PeerHubStatus, ProjectId } from "@t3tools/contracts";
import { Share2Icon } from "lucide-react";
import { useState } from "react";

import { useScratchProject } from "../../hooks/useScratchProject";
import { useProjects } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { isLocalScope, type ResolvedProjectScope } from "./projectScope.logic";
import { shareRowNote, shareRows } from "./shareProject.logic";
import type { PeerWebPlugin } from "./slots.types";
import type { WorkActions } from "./useWorkActions";
import { reportFailure } from "./workFeedback";

/**
 * Any member shares a project with the workspace the way "Add project" takes
 * one: a repository by its address (GitHub's owner/repo or a clone URL), or a
 * project on this computer by its origin. Everyone then clones it with
 * "Clone & open". The project the sidebar has open is the first offer; any
 * other is a choice the person opens, so a list never reads as being about it.
 */
export function ShareProject({
  environmentId,
  status,
  plugins,
  scope,
  actions,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly scope: ResolvedProjectScope;
  readonly actions: WorkActions;
}) {
  const projects = useProjects();
  const { scratchWorkspaceRootFor } = useScratchProject();
  const shareProject = useAtomCommand(serverEnvironment.peerHubShareProject, {
    reportFailure: false,
  });
  const [open, setOpen] = useState(false);
  const [workspace, setWorkspace] = useState(status.workspaces[0]?.slug ?? "");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // Threads without a project ("No project") have no repository to share.
  const scratchRoot = scratchWorkspaceRootFor(environmentId);
  const rows = shareRows(
    projects.filter(
      (project) =>
        project.environmentId === environmentId && !isScratchProject(project, scratchRoot),
    ),
    scope.refs,
    status.workspaces,
  );
  const openUnshared = isLocalScope(scope.scope)
    ? rows.find((row) => row.open && row.sharedWith.length === 0)?.project
    : undefined;
  const onlyWorkspace = status.workspaces.length === 1 ? status.workspaces[0] : undefined;
  const workspaceName = status.workspaces.find((w) => w.slug === workspace)?.name ?? workspace;
  const share = (
    key: string,
    label: string,
    what: { readonly projectId: ProjectId } | { readonly repository: string },
  ) => {
    setBusy(key);
    void shareProject({ environmentId, input: { workspace, ...what } })
      .then((result) => {
        if (reportFailure(`Could not share ${label}`, result)) {
          toastManager.add({ type: "success", title: `${label} is shared with ${workspaceName}` });
          setAddress("");
          setOpen(false);
        }
      })
      .finally(() => setBusy(null));
  };
  if (!open) {
    if (openUnshared === undefined) {
      return (
        <Button
          className="mx-2 self-start"
          size="xs"
          variant="ghost-muted"
          onClick={() => setOpen(true)}
        >
          <Share2Icon className="size-3.5" />
          {scope.refs === null || isLocalScope(scope.scope)
            ? "Share a project"
            : "Share another project"}
        </Button>
      );
    }
    return (
      <div className="mx-2 flex min-w-0 flex-wrap items-center gap-1">
        <Button
          className="min-w-0"
          size="xs"
          variant="outline"
          onClick={() => {
            if (onlyWorkspace === undefined) setOpen(true);
            else void actions.shareProject(openUnshared, openUnshared.title, onlyWorkspace);
          }}
        >
          <Share2Icon className="size-3.5" />
          <span className="min-w-0 truncate">
            Share {openUnshared.title}
            {onlyWorkspace === undefined ? "" : ` with ${onlyWorkspace.name}`}…
          </span>
        </Button>
        {onlyWorkspace === undefined ? null : (
          <Button size="xs" variant="ghost-muted" onClick={() => setOpen(true)}>
            Another project
          </Button>
        )}
      </div>
    );
  }
  return (
    <section
      aria-label="Share a project"
      className="mx-1 rounded-md border border-sidebar-border p-2"
    >
      <h3 className="text-xs font-medium text-sidebar-foreground">Share with {workspaceName}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Pick a project. Everyone in the workspace sees it and clones it with “Clone &amp; open”.
      </p>
      {status.workspaces.length > 1 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {status.workspaces.map((w) => (
            <Button
              key={w.slug}
              size="xs"
              variant={w.slug === workspace ? "secondary" : "ghost"}
              onClick={() => setWorkspace(w.slug)}
            >
              {w.name}
            </Button>
          ))}
        </div>
      ) : null}
      {rows.length > 0 ? (
        <>
          <p className="mt-3 text-xs text-muted-foreground">On this computer</p>
          <ul className="mt-1 flex flex-col gap-1">
            {rows.map((row) => {
              const note = shareRowNote(row);
              return (
                <li key={row.project.id} className="flex min-h-6 items-center gap-2">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">{row.project.title}</span>
                    {note === null ? null : (
                      <span className="truncate text-xs text-muted-foreground">{note}</span>
                    )}
                  </span>
                  {row.sharedWith.length > 0 ? null : (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() =>
                        share(row.project.id, row.project.title, { projectId: row.project.id })
                      }
                    >
                      {busy === row.project.id ? "Sharing…" : "Share"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">
        {rows.length > 0 ? "Or by address" : "By address"}
      </p>
      <form
        className="mt-1 flex gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          const repository = address.trim();
          if (repository === "" || busy !== null) return;
          share("address", repository, { repository });
        }}
      >
        <Input
          className="min-w-0 flex-1"
          size="sm"
          nativeInput
          placeholder="owner/repo or clone URL"
          aria-label="Repository to share"
          value={address}
          readOnly={busy !== null}
          onChange={(event) => setAddress(event.currentTarget.value)}
        />
        <Button type="submit" size="xs" disabled={busy !== null || address.trim() === ""}>
          {busy === "address" ? "Sharing…" : "Share"}
        </Button>
      </form>
      {plugins.map(({ id, shareProject: Note }) =>
        Note === undefined ? null : <Note key={id} environmentId={environmentId} status={status} />,
      )}
      <div className="mt-2 flex justify-end">
        <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </section>
  );
}
