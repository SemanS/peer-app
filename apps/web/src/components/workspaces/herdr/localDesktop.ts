import type { EnvironmentId } from "@t3tools/contracts";

import { isElectron } from "../../../env";
import { appAtomRegistry } from "../../../rpc/atomRegistry";
import { usePrimaryEnvironmentId } from "../../../state/environments";
import { primaryEnvironmentIdAtom } from "../../../state/primaryEnvironment";

/**
 * Whether this is the desktop app connected to its own backend: the one place a terminal can open
 * on the computer that runs herdr. The desktop's primary environment is its own server (there is
 * none when its local environment is disabled); browsers and other environments get the command.
 */
const isLocalDesktop = (environmentId: EnvironmentId | null, primaryId: EnvironmentId | null) =>
  isElectron && environmentId !== null && environmentId === primaryId;

export function useIsLocalDesktop(environmentId: EnvironmentId | null): boolean {
  return isLocalDesktop(environmentId, usePrimaryEnvironmentId());
}

export function isLocalDesktopEnvironment(environmentId: EnvironmentId): boolean {
  return isLocalDesktop(environmentId, appAtomRegistry.get(primaryEnvironmentIdAtom));
}
