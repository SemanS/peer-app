import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";

import type { PeerWebPlugin } from "./slots.types";
import type { WorkProjectNode } from "./workTree.logic";

/** What changed in a project and how the work went, from the plugins that keep it. */
export function ProjectHistory({
  environmentId,
  status,
  project,
  plugins,
  activeThread,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly project: WorkProjectNode;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly activeThread: string | null;
}) {
  return (
    <>
      {plugins.map(({ id, projectHistory: Section }) =>
        Section === undefined ? null : (
          <Section
            key={id}
            environmentId={environmentId}
            status={status}
            project={project}
            activeThread={activeThread}
          />
        ),
      )}
    </>
  );
}
