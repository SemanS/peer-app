import type { PeerMobilePlugin } from "../slotTypes";
import { HerdrRuntimeSection } from "./HerdrRuntimeSection";
import { PeerAgents } from "./PeerAgents";

/** herdr agents: the runtime and the agents running on the environment. */
export const herdrMobilePlugin: PeerMobilePlugin = {
  id: "herdr",
  workspaceSections: [
    { place: "end", Component: HerdrRuntimeSection },
    { place: "end", Component: PeerAgents },
  ],
};
