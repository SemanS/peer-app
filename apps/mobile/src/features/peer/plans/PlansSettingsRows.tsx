import type { EnvironmentId } from "@t3tools/contracts";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { SettingsRow } from "../../settings/components/SettingsRow";
import { useSettingsEnvironmentFilter } from "../../settings/settings-environment-filter";
import { plansRowValue } from "./plans.logic";

function PlansEnvironmentRow({
  environmentId,
  label,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}) {
  const query = useEnvironmentQuery(serverEnvironment.peerHubLive({ environmentId, input: {} }));
  const value = plansRowValue(query.data);
  if (value === null) return null;
  return (
    <SettingsRow
      icon="point.3.connected.trianglepath.dotted"
      label={label}
      value={value}
      target="SettingsPeerHub"
    />
  );
}

/**
 * Plans in the Settings index: how it stands on each computer the settings are showing (on, off,
 * forced off, waiting for a Hub, needing a newer one), opening Peer workspaces, where the switch
 * and the reason are. A computer that does not list Plans has no row.
 */
export function PlansSettingsRows() {
  const { selectedTargets } = useSettingsEnvironmentFilter();
  return selectedTargets.map((target) => (
    <PlansEnvironmentRow
      key={target.environmentId}
      environmentId={target.environmentId}
      label={selectedTargets.length > 1 ? `Plans · ${target.label}` : "Plans"}
    />
  ));
}
