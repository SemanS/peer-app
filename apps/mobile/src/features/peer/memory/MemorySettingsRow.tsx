import { activePlugin } from "@t3tools/client-runtime/peer/plugins";
import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useWorkspaceEnvironments } from "../../../state/workspace";
import { SettingsRow } from "../../settings/components/SettingsRow";

/** The entry appears when at least one connected environment actually runs Memory. */
export function MemorySettingsRow() {
  const navigation = useNavigation();
  const environments = useWorkspaceEnvironments().filter(
    (row) => row.connectionState === "connected",
  );
  const [active, setActive] = useState<Readonly<Record<string, boolean>>>({});
  const update = useCallback(
    (id: EnvironmentId, value: boolean) =>
      setActive((before) => (before[id] === value ? before : { ...before, [id]: value })),
    [],
  );
  return (
    <>
      {environments.map(({ environmentId }) => (
        <MemoryAvailability key={environmentId} environmentId={environmentId} onChange={update} />
      ))}
      {environments.some(({ environmentId }) => active[environmentId]) ? (
        <SettingsRow
          icon="brain"
          label="Memory"
          onPress={() => navigation.navigate("MemoryProjects")}
        />
      ) : null}
    </>
  );
}
function MemoryAvailability({
  environmentId,
  onChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly onChange: (id: EnvironmentId, active: boolean) => void;
}) {
  const query = useEnvironmentQuery(serverEnvironment.peerHubLive({ environmentId, input: {} }));
  const active = query.error === null && activePlugin(query.data, "memory");
  useEffect(() => {
    onChange(environmentId, active);
    return () => onChange(environmentId, false);
  }, [environmentId, active, onChange]);
  return null;
}
