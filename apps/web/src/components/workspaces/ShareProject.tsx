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
import type { PeerWebPlugin } from "./slots.types";
import { reportFailure } from "./useWorkActions";

/**
 * Any member shares a project with the workspace the way "Add project" takes
 * one: a repository by its address (GitHub's owner/repo or a clone URL), or a
 * project on this computer by its origin. Everyone then clones it with
 * "Clone & open".
 */
export function ShareProject({
  environmentId,
  status,
  plugins,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
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
  const bound = new Set(
    status.workspaces.flatMap((w) =>
      w.projects.flatMap((p) => p.repositories.flatMap((r) => (r.projectId ? [r.projectId] : []))),
    ),
  );
  // Threads without a project ("No project") have no repository to share.
  const scratchRoot = scratchWorkspaceRootFor(environmentId);
  const candidates = projects.filter(
    (project) =>
      project.environmentId === environmentId &&
      !bound.has(project.id) &&
      !isScratchProject(project, scratchRoot),
  );
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
    return (
      <Button
        className="mx-2 self-start"
        size="xs"
        variant="ghost-muted"
        onClick={() => setOpen(true)}
      >
        <Share2Icon className="size-3.5" />
        Share a project with your team
      </Button>
    );
  }
  return (
    <section
      aria-label="Share a project"
      className="mx-1 rounded-md border border-sidebar-border p-2"
    >
      <p className="text-xs text-muted-foreground">
        Everyone in the workspace sees the project and clones it with “Clone &amp; open”.
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
      <form
        className="mt-2 flex gap-1"
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
      {candidates.length > 0 ? (
        <>
          <p className="mt-3 text-xs text-muted-foreground">Or a project on this computer:</p>
          <ul className="mt-1 flex flex-col gap-px">
            {candidates.map((project) => (
              <li key={project.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">{project.title}</span>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => share(project.id, project.title, { projectId: project.id })}
                >
                  {busy === project.id ? "Sharing…" : "Share"}
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <div className="mt-2 flex justify-end">
        <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </section>
  );
}
