import type { EnvironmentId } from "@t3tools/contracts";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { useEnvironmentIds } from "../../state/environments";
import { PEER_WEB_PLUGINS, usePeerPlugins } from "./slots";
import { usePeerHubStatus } from "./WorkspaceAccess";

type ActivePlugins = ReadonlyMap<EnvironmentId, ReadonlyArray<string>>;

/** The background plugins `environment` runs, or none once it is gone (`null`). */
function withPlugins(
  previous: ActivePlugins,
  environment: EnvironmentId,
  plugins: ReadonlyArray<string> | null,
): ActivePlugins {
  const next = new Map(previous);
  if (plugins === null) next.delete(environment);
  else next.set(environment, plugins);
  return next;
}

/** Plugin effects survive navigation and are mounted once across environments. */
export function PeerBackground() {
  const environmentIds = useEnvironmentIds();
  const [active, setActive] = useState<ActivePlugins>(new Map());
  const ids = new Set(environmentIds.flatMap((environment) => active.get(environment) ?? []));
  return (
    <>
      {environmentIds.map((environmentId) => (
        <BackgroundEnvironment
          key={environmentId}
          environmentId={environmentId}
          setActive={setActive}
        />
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
  setActive,
}: {
  readonly environmentId: EnvironmentId;
  readonly setActive: Dispatch<SetStateAction<ActivePlugins>>;
}) {
  const status = usePeerHubStatus(environmentId),
    plugins = usePeerPlugins(status);
  const connected = status !== null;
  useEffect(() => {
    const running = !connected
      ? []
      : plugins.filter((plugin) => plugin.background !== undefined).map((plugin) => plugin.id);
    setActive((previous) => withPlugins(previous, environmentId, running));
  }, [environmentId, plugins, connected, setActive]);
  useEffect(
    () => () => setActive((previous) => withPlugins(previous, environmentId, null)),
    [environmentId, setActive],
  );
  return null;
}
