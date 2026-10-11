import type { PeerPersonalCapacityPolicy } from "@t3tools/contracts";
import { useState } from "react";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { SettingsRow } from "../../settings/settingsLayout";
import { Button } from "../../ui/button";
import { Switch } from "../../ui/switch";
import type { ProjectSettingsSlotProps } from "../slots.types";
import { reportFailure } from "../workFeedback";

const PERSONAL_POLICY: Record<PeerPersonalCapacityPolicy, string> = {
  any: "Your own subscription or seat works here.",
  commercial:
    "Client work: only Team, Enterprise or API logins (commercial terms) — or the shared capacity.",
  none: "Shared capacity only.",
};

/**
 * A project's capacity under Settings → Peer: what its policy allows, its shared budget and
 * your share of it, the switch that uses it on this environment, and what has been spent.
 */
export function CapacityRows({ environmentId, workspace, state }: ProjectSettingsSlotProps) {
  const { project } = state;
  const currency = workspace.currency;
  const setShared = useAtomCommand(serverEnvironment.peerHubSetSharedCapacity, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const [showUsage, setShowUsage] = useState(false);
  const usage = useEnvironmentQuery(
    showUsage
      ? serverEnvironment.peerHubProjectUsage({
          environmentId,
          input: { workspace: workspace.slug, projectId: project.id },
        })
      : null,
  );
  const shared = project.capacity.shared;
  const input = { workspace: workspace.slug, projectId: project.id };

  const toggleShared = async (enabled: boolean) => {
    setBusy(true);
    try {
      reportFailure(
        `Could not change ${project.name}'s shared capacity`,
        await setShared({ environmentId, input: { ...input, enabled } }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SettingsRow
        title={<span className="pl-8 text-muted-foreground">Capacity</span>}
        description={
          shared === undefined
            ? PERSONAL_POLICY[project.capacity.personal]
            : `${PERSONAL_POLICY[project.capacity.personal]} Shared capacity: ${shared.budget.amount} ${currency}/${shared.budget.period}${shared.allocation === undefined ? "" : `, your share ${shared.allocation} ${currency}`}.${state.sharedCapacity.error ? ` ${state.sharedCapacity.error}` : ""}`
        }
        control={
          shared === undefined ? null : (
            <div className="flex items-center gap-2">
              <Button size="xs" variant="ghost" onClick={() => setShowUsage((value) => !value)}>
                {showUsage ? "Hide usage" : "Usage"}
              </Button>
              <Switch
                checked={state.sharedCapacity.enabled}
                disabled={busy}
                aria-label={`Use ${project.name}'s shared capacity on this machine`}
                onCheckedChange={(checked) => void toggleShared(checked)}
              />
            </div>
          )
        }
      />
      {showUsage && shared !== undefined ? (
        <SettingsRow
          title={
            <span className="pl-12 text-muted-foreground">Spent this {shared.budget.period}</span>
          }
          description={
            usage.data === null
              ? (usage.error ?? "Loading…")
              : usage.data.shared === null
                ? "The gateway reports no spend yet."
                : `${usage.data.shared.spent} of ${usage.data.shared.budget} ${usage.data.currency}: ${usage.data.shared.members
                    .map(
                      (m) =>
                        `${m.name} ${m.spent}${m.allocation === null ? "" : `/${m.allocation}`}`,
                    )
                    .join(", ")}`
          }
        />
      ) : null}
    </>
  );
}
