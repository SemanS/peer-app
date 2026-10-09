import type { PeerMobilePlugin } from "../slotTypes";
import { PeerDigest } from "./PeerDigest";
import { VisitsBackground } from "./VisitsBackground";
export const digestMobilePlugin: PeerMobilePlugin = {
  id: "digest",
  background: VisitsBackground,
  workspaceSections: [{ place: "tasks", Component: PeerDigest }],
};
