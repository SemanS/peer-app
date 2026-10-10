import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { ChevronLeftIcon } from "lucide-react";

import { Button } from "../ui/button";
import type { PeerWebPlugin } from "./slots.types";
import type { WorkProjectNode } from "./workTree.logic";

/**
 * A project's History, one click below its tasks: what changed and how the work went, from the
 * plugins that keep it. The Work view shows only what holds now.
 */
export function ProjectHistory({
  environmentId,
  status,
  project,
  plugins,
  activeThread,
  onBack,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly project: WorkProjectNode;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly activeThread: string | null;
  readonly onBack: () => void;
}) {
  return (
    <section aria-label={`History of ${project.name}`} className="flex flex-col gap-3">
      <div>
        <Button size="xs" variant="ghost" onClick={onBack}>
          <ChevronLeftIcon aria-hidden className="size-3.5" />
          Work
        </Button>
      </div>
      <div className="px-2">
        <h2 className="text-base font-semibold text-sidebar-foreground">History</h2>
        <p className="truncate text-xs text-muted-foreground">{project.name}</p>
      </div>
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
    </section>
  );
}
