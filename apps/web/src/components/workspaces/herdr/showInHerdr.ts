import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";

import { appAtomRegistry } from "../../../rpc/atomRegistry";
import { serverEnvironment } from "../../../state/server";
import { reportFailure } from "../workFeedback";

/** Brings a herdr agent's pane forward in herdr itself. */
export async function showInHerdr(environmentId: EnvironmentId, paneId: string): Promise<void> {
  reportFailure(
    "Could not show that agent in herdr",
    await runAtomCommand(
      appAtomRegistry,
      serverEnvironment.peerHubFocusAgent,
      { environmentId, input: { paneId } },
      { reportFailure: false },
    ),
  );
}
