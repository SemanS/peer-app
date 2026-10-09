import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback, useEffect, useState } from "react";
import { useEnvironmentIds } from "../../state/environments";
import { PEER_WEB_PLUGINS, usePeerPlugins } from "./slots";
import { usePeerHubStatus } from "./WorkspaceAccess";

/** Plugin effects survive navigation and are mounted once across environments. */
export function PeerBackground() {
  const environmentIds = useEnvironmentIds();
  const [active, setActive] = useState<ReadonlyMap<EnvironmentId, ReadonlyArray<string>>>(
    new Map(),
  );
  const update = useCallback(
    (environment: EnvironmentId, plugins: ReadonlyArray<string> | null) =>
      setActive((previous) => {
        const next = new Map(previous);
        if (plugins === null) next.delete(environment);
        else next.set(environment, plugins);
        return next;
      }),
    [],
  );
  const ids = new Set(environmentIds.flatMap((environment) => active.get(environment) ?? []));
  return (
    <>
      {environmentIds.map((environmentId) => (
        <BackgroundEnvironment key={environmentId} environmentId={environmentId} update={update} />
      ))}
      {PEER_WEB_PLUGINS.map(({ id, background: Background }) =>
        Background === undefined || !ids.has(id) ? null : (
          <Background key={id} environmentIds={environmentIds} />
        ),
      )}
    </>
  );
}
function BackgroundEnvironment({
  environmentId,
  update,
}: {
  readonly environmentId: EnvironmentId;
  readonly update: (environment: EnvironmentId, plugins: ReadonlyArray<string> | null) => void;
}) {
  const status = usePeerHubStatus(environmentId),
    plugins = usePeerPlugins(status);
  const connected = status !== null;
  useEffect(() => {
    update(
      environmentId,
      !connected
        ? []
        : plugins.filter((plugin) => plugin.background !== undefined).map((plugin) => plugin.id),
    );
  }, [environmentId, plugins, connected, update]);
  useEffect(() => () => update(environmentId, null), [environmentId, update]);
  return null;
}
