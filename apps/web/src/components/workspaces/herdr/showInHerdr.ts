import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";

import { appAtomRegistry } from "../../../rpc/atomRegistry";
import { serverEnvironment } from "../../../state/server";
import { reportFailure } from "../workFeedback";
import { isLocalDesktopEnvironment } from "./localDesktop";

/**
 * Brings a herdr agent's pane forward in herdr itself. On the desktop app's own computer it also
 * opens a terminal on Peer's herdr first when none is attached.
 */
export async function showInHerdr(environmentId: EnvironmentId, paneId: string): Promise<void> {
  reportFailure(
    "Could not show that agent in herdr",
    await runAtomCommand(
      appAtomRegistry,
      serverEnvironment.peerHubFocusAgent,
      {
        environmentId,
        input: {
          paneId,
          ...(isLocalDesktopEnvironment(environmentId) ? { openWindow: true } : {}),
        },
      },
      { reportFailure: false },
    ),
  );
}
