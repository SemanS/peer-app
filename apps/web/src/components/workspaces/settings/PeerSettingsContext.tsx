import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { useLocation } from "@tanstack/react-router";
import { createContext, use, type ReactNode } from "react";

import { useEnvironments, usePrimaryEnvironmentId } from "../../../state/environments";
import { validateSettingsScopeSearch } from "../../settings/settingsScope";
import { useActiveOrganization } from "../organizationChoice";
import { usePeerHubStatus } from "../WorkspaceAccess";
import { selectPeerEnvironment } from "./peerSettings.logic";

/**
 * The environment whose Peer the settings area shows, and its status. The navigation lives in the
 * app sidebar, outside the settings scope, so both read the environment the way this does: the
 * `machine` the address names, else the primary one.
 */
export function usePeerSettingsEnvironment() {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const machine = useLocation({
    select: (location) => validateSettingsScopeSearch(location.search).machine,
  });
  const environment = selectPeerEnvironment(environments, primaryEnvironmentId, machine);
  const connected =
    environment !== null &&
    environment.connection.phase === "connected" &&
    environment.serverConfig !== null;
  const status = usePeerHubStatus(connected ? environment.environmentId : null);
  return { environments, environment, connected, status };
}

/** What a settings page of a signed-in environment reads. */
interface PeerSettingsValue {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
}

const PeerSettingsContext = createContext<PeerSettingsValue | null>(null);

export function PeerSettingsProvider({
  value,
  children,
}: {
  readonly value: PeerSettingsValue;
  readonly children: ReactNode;
}) {
  return <PeerSettingsContext value={value}>{children}</PeerSettingsContext>;
}

/** Null where no one is signed in (the sign-in view), so shared parts can skip what needs a person. */
export function useOptionalPeerSettings(): PeerSettingsValue | null {
  return use(PeerSettingsContext);
}

export function usePeerSettings(): PeerSettingsValue {
  const value = useOptionalPeerSettings();
  if (value === null) throw new Error("Peer settings must be read inside PeerSettingsProvider.");
  return value;
}

/**
 * The workspace the person last had open here, so This computer's pages keep showing it. It is the
 * active organization the sidebar names, so Work follows it too.
 */
export function useLastPeerWorkspace(): [string | null, (slug: string) => void] {
  const { chosen, choose } = useActiveOrganization();
  return [chosen, choose];
}
