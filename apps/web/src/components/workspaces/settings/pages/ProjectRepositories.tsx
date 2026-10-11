import { SettingsRow, SettingsSection } from "../../../settings/settingsLayout";
import { Badge } from "../../../ui/badge";
import { Button } from "../../../ui/button";
import { useOpenWorkspaceProject } from "../../useOpenWorkspaceProject";
import { CheckoutBadge } from "../CheckoutBadge";
import type { ProjectPageProps } from "../pageProps";
import { ComingInThisChange } from "../PeerSettingsPage";

/**
 * A project's Repositories tab: where each stands on this computer, and Clone & open, which puts
 * the missing ones here and opens the project.
 */
export function ProjectRepositories({ environmentId, workspace, state }: ProjectPageProps) {
  const { project } = state;
  const opener = useOpenWorkspaceProject({
    environmentId,
    workspace: workspace.slug,
    projectId: project.id,
    name: project.name,
  });
  const missingRepos = state.repositories.filter(
    (repo) => repo.state === "missing" || repo.state === "error",
  );
  const unregistered = state.repositories.filter(
    (repo) => repo.state === "ready" && repo.projectId === undefined,
  );
  const cloning = state.repositories.some((repo) => repo.state === "cloning");
  return (
    <>
      <SettingsSection title="Repositories" hideTitle>
        <SettingsRow
          title="On this computer"
          description={`${project.name}’s repositories as cloned here.`}
          control={
            project.repositories.length === 0 ? (
              <Badge variant="outline">no repositories yet</Badge>
            ) : missingRepos.length > 0 || unregistered.length > 0 ? (
              <Button
                size="sm"
                disabled={cloning || opener.opening}
                onClick={() => void opener.open()}
              >
                {cloning || opener.opening
                  ? missingRepos.length > 0
                    ? "Cloning…"
                    : "Opening…"
                  : missingRepos.length > 0
                    ? "Clone & open"
                    : "Open"}
              </Button>
            ) : (
              <Badge variant="success">in sidebar</Badge>
            )
          }
        />
        {state.repositories.map((repo) => (
          <SettingsRow
            key={repo.id}
            title={repo.id}
            description={
              repo.error
                ? `${repo.url} — ${repo.error}`
                : `${repo.url} (${repo.branch}) → ${repo.path}`
            }
            status={<CheckoutBadge state={repo.state} />}
          />
        ))}
      </SettingsSection>
      <ComingInThisChange>
        adding a repository by its address, and a warning for hosts other than GitHub
      </ComingInThisChange>
    </>
  );
}
