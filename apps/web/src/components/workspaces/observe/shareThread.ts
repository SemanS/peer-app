import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";

import { appAtomRegistry } from "../../../rpc/atomRegistry";
import { serverEnvironment } from "../../../state/server";
import { reportFailure } from "../useWorkActions";

/** Lets the team watch one of your threads live, or stops it. */
export async function shareThread(
  environmentId: EnvironmentId,
  thread: string,
  shared: boolean,
): Promise<void> {
  reportFailure(
    shared ? "Could not share the thread" : "Could not stop sharing the thread",
    await runAtomCommand(
      appAtomRegistry,
      serverEnvironment.peerHubShareThread,
      { environmentId, input: { thread, shared } },
      { reportFailure: false },
    ),
  );
}
