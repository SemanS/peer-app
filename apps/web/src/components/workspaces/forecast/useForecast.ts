import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import {
  forecastAvailable,
  createForecastTaskSelector,
} from "@t3tools/client-runtime/peer-forecast";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
const selectors = new Map<EnvironmentId, ReturnType<typeof createForecastTaskSelector>>();
export function useForecast(environmentId: EnvironmentId, status: PeerHubStatus) {
  const plugin = status.plugins?.find((p) => p.id === "forecast");
  const query = useEnvironmentQuery(
    plugin?.active ? serverEnvironment.peerForecastLive({ environmentId, input: {} }) : null,
  );
  const value =
    plugin?.enabled === false
      ? {
          state: "off" as const,
          reason: "disabled" as const,
          teammates: false,
          pairs: [],
          tracked: 0,
          skipped: 0,
          notOnOrigin: 0,
          paused: [],
        }
      : forecastAvailable(query);
  let select = selectors.get(environmentId);
  if (select === undefined) {
    select = createForecastTaskSelector();
    selectors.set(environmentId, select);
  }
  return { value, tasks: select(value) };
}
