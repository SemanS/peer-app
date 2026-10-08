import type { PeerWebPlugin } from "../slots";
import { StartTaskAgent } from "../StartTaskAgent";

/** herdr agents: the launcher that starts an agent on a task, and accepts a teammate's request. */
export const herdrWebPlugin: PeerWebPlugin = {
  id: "herdr",
  taskLauncher: StartTaskAgent,
};
