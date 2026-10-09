import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect } from "react";
import { usePeerHubStatus } from "../WorkspaceAccess";
import { activateVisits } from "./visitTracker";
function EnvironmentVisit({ environmentId }: { environmentId: EnvironmentId }) {
  const status = usePeerHubStatus(environmentId),
    email =
      status?.signedIn && status.plugins?.some((p) => p.id === "digest" && p.active)
        ? status.email
        : null;
  useEffect(() => (email ? activateVisits(email) : undefined), [email]);
  return null;
}
export function DigestBackground({
  environmentIds,
}: {
  environmentIds: ReadonlyArray<EnvironmentId>;
}) {
  return environmentIds.map((environmentId) => (
    <EnvironmentVisit key={environmentId} environmentId={environmentId} />
  ));
}
