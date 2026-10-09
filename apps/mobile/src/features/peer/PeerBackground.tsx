import { useCallback, useEffect, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { PEER_MOBILE_PLUGINS, usePeerMobilePlugins } from "./slots";
/** Active plugin effects are mounted once, outside screen navigation. */
export function PeerBackground() {
  const { environments } = useEnvironments(),
    [active, setActive] = useState<ReadonlyMap<EnvironmentId, ReadonlyArray<string>>>(new Map());
  const update = useCallback(
    (id: EnvironmentId, plugins: ReadonlyArray<string> | null) =>
      setActive((previous) => {
        const next = new Map(previous);
        if (plugins === null) next.delete(id);
        else next.set(id, plugins);
        return next;
      }),
    [],
  );
  const connected = environments.filter((e) => e.connection.phase === "connected");
  return (
    <>
      {connected.map((e) => (
        <EnvironmentPlugins key={e.environmentId} environmentId={e.environmentId} update={update} />
      ))}
      {PEER_MOBILE_PLUGINS.map(({ id, background: Background }) => {
        const environmentIds = connected
          .filter((e) => active.get(e.environmentId)?.includes(id))
          .map((e) => e.environmentId);
        return Background && environmentIds.length ? (
          <Background key={id} environmentIds={environmentIds} />
        ) : null;
      })}
    </>
  );
}
function EnvironmentPlugins({
  environmentId,
  update,
}: {
  environmentId: EnvironmentId;
  update: (id: EnvironmentId, plugins: ReadonlyArray<string> | null) => void;
}) {
  const query = useEnvironmentQuery(serverEnvironment.peerHubLive({ environmentId, input: {} })),
    plugins = usePeerMobilePlugins(query.data);
  useEffect(() => {
    update(
      environmentId,
      plugins.filter((p) => p.background).map((p) => p.id),
    );
  }, [environmentId, plugins, update]);
  useEffect(() => () => update(environmentId, null), [environmentId, update]);
  return null;
}
