import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import type { PeerWebPlugin } from "./slots.types";

/**
 * What Work says while no workspace lists a project for the person. A plugin that knows more
 * (who to ask to be added, how to start a project) speaks for each workspace without one, through
 * its `noProjects` slot; core's own `fallback` line stands while no active plugin does, so Work
 * explains itself with every plugin off.
 */
export function WorkNoProjects({
  environmentId,
  status,
  plugins,
  fallback,
  className,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly fallback: ReactNode;
  /** Layout only: where and how wide the plugin's cards sit. */
  readonly className?: string;
}) {
  const Speaks = plugins.find((plugin) => plugin.noProjects !== undefined)?.noProjects;
  const without = status.workspaces.filter((workspace) => workspace.projects.length === 0);
  if (Speaks === undefined || without.length === 0) return fallback;
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {without.map((workspace) => (
        <Speaks
          key={workspace.slug}
          environmentId={environmentId}
          status={status}
          workspace={workspace}
        />
      ))}
    </div>
  );
}
