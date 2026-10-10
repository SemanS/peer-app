import type { PeerMobilePlugin } from "../slotTypes";
import { HerdrRuntimeSection } from "./HerdrRuntimeSection";
import { PeerAgents } from "./PeerAgents";
import { PeerTaskLaunch } from "./PeerTaskLaunch";

/** herdr agents: starting an agent on a task, and the agents running on the environment. */
export const herdrMobilePlugin: PeerMobilePlugin = {
  id: "herdr",
  workspaceSections: [
    { place: "end", Component: HerdrRuntimeSection },
    { place: "end", Component: PeerAgents },
  ],
  taskSections: PeerTaskLaunch,
  taskLauncher: PeerTaskLaunch,
};
