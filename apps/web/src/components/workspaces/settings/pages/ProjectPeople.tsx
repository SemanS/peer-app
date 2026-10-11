import { SettingsRow, SettingsSection } from "../../../settings/settingsLayout";
import type { ProjectPageProps } from "../pageProps";
import { ComingInThisChange } from "../PeerSettingsPage";

/** A project's People tab: who is on it, and who is working on it now. */
export function ProjectPeople({ state }: ProjectPageProps) {
  const { project } = state;
  return (
    <>
      <SettingsSection title="People" hideTitle>
        <SettingsRow
          title="Members"
          description={
            project.members.length === 0
              ? "No members."
              : `${project.members.length} member${project.members.length === 1 ? "" : "s"}: ${project.members.map((member) => member.name).join(", ")}`
          }
        />
        {state.peers.length > 0 ? (
          <SettingsRow
            title="Working now"
            description={state.peers
              .map((peer) =>
                peer.threads.length === 0
                  ? `${peer.name} (idle)`
                  : `${peer.name}: ${peer.threads
                      .map(
                        (thread) =>
                          `“${thread.title}” ${thread.status}${thread.branch ? ` on ${thread.branch}` : ""}`,
                      )
                      .join("; ")}`,
              )
              .join(" · ")}
          />
        ) : null}
      </SettingsSection>
      <ComingInThisChange>
        whether the whole workspace or selected people are on the project, its leads, and each
        person’s allocation
      </ComingInThisChange>
    </>
  );
}
