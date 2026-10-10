import type { PeerWebPlugin } from "../slots.types";
import { DigestBackground } from "./DigestBackground";
import { DigestHistory, DigestHistoryBadge } from "./DigestHistory";
export const digestWebPlugin: PeerWebPlugin = {
  id: "digest",
  background: DigestBackground,
  projectHistory: DigestHistory,
  historyBadge: DigestHistoryBadge,
};
