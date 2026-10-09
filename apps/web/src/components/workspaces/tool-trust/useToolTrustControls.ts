import { toolTrustPermissions } from "@t3tools/client-runtime/peer-tool-trust";
import type { EnvironmentId } from "@t3tools/contracts";
import { isElectron } from "../../../env";
import { usePrimarySessionState } from "../../../environments/primary";
import { usePrimaryEnvironmentId } from "../../../state/environments";
import { serverEnvironment } from "../../../state/server";
import { useEnvironmentSessionState } from "../../../state/session";
import { useAtomCommand } from "../../../state/use-atom-command";
export function useToolTrustControls(environmentId: EnvironmentId) {
  const primary = usePrimaryEnvironmentId() === environmentId;
  const primarySession = usePrimarySessionState();
  const remote = useEnvironmentSessionState(environmentId);
  const permissions =
    primary && isElectron
      ? { approve: true, turnOff: true }
      : toolTrustPermissions(primary ? primarySession.data : remote.data);
  return {
    ...permissions,
    approveTools: useAtomCommand(serverEnvironment.peerToolTrustApprove, { reportFailure: false }),
    turnOffTools: useAtomCommand(serverEnvironment.peerToolTrustTurnOff, { reportFailure: false }),
    setSecret: useAtomCommand(serverEnvironment.peerToolTrustSetSecret, { reportFailure: false }),
  };
}
