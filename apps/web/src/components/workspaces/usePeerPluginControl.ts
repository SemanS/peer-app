import { canChangePeerPlugins } from "@t3tools/client-runtime/peer/plugins";
import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback } from "react";

import { isElectron } from "../../env";
import { usePrimarySessionState } from "../../environments/primary";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentSessionState } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { failureMessage } from "./WorkspaceAccess";

/**
 * Turning Peer plugins on and off on one environment. Only its owner may: the desktop app owns its
 * own server, a browser session on the primary environment checks its cookie's scopes, and a remote
 * environment is asked for the scopes of this client's session on it.
 */
export function usePeerPluginControl(environmentId: EnvironmentId) {
  const isPrimary = usePrimaryEnvironmentId() === environmentId;
  const primarySession = usePrimarySessionState();
  const remoteSession = useEnvironmentSessionState(environmentId);
  const setPlugin = useAtomCommand(serverEnvironment.peerHubSetPlugin, { reportFailure: false });
  const owner = isPrimary
    ? isElectron || canChangePeerPlugins(primarySession.data)
    : canChangePeerPlugins(remoteSession.data);
  /** Applies the choice; resolves with why it failed, or null. */
  const change = useCallback(
    async (id: string, enabled: boolean) =>
      failureMessage(await setPlugin({ environmentId, input: { id, enabled } })),
    [environmentId, setPlugin],
  );
  return { owner, change };
}
