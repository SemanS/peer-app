import { SettingsRow, SettingsSection } from "../../../settings/settingsLayout";
import type { ProjectPageProps } from "../pageProps";
import { ComingInThisChange } from "../PeerSettingsPage";

/** A project's Tools tab: the tools it uses, and the commands this computer lacks for them. */
export function ProjectTools({ state }: ProjectPageProps) {
  return (
    <>
      <SettingsSection title="Tools" hideTitle>
        <SettingsRow
          title="Tools"
          description={
            state.tools.length === 0
              ? "No shared tools."
              : state.tools
                  .map((tool) =>
                    tool.missing.length === 0
                      ? tool.name
                      : `${tool.name} (missing ${tool.missing.map((m) => m.command).join(", ")}${tool.missing[0]?.install ? `: ${tool.missing[0].install}` : ""})`,
                  )
                  .join(" · ")
          }
        />
      </SettingsSection>
      <ComingInThisChange>
        adding tools from the workspace catalog, their versions, and whether this computer approved
        them
      </ComingInThisChange>
    </>
  );
}
