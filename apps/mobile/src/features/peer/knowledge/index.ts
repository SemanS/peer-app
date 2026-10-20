import type { PeerMobilePlugin } from "../slotTypes";
import { ChallengedSection } from "./ChallengedSection";

/**
 * Knowledge: what agents found that a project may keep. The phone shows how much waits; keeping
 * or dismissing it happens on web or desktop. Challenged entries can be seconded, dismissed and
 * resolved here; a replacement or a retirement is staged from web or desktop.
 */
export const knowledgeMobilePlugin: PeerMobilePlugin = {
  id: "knowledge",
  workspaceSections: [{ place: "end", Component: ChallengedSection }],
  projectSignals: (_status, { candidates }) => [
    {
      id: "knowledge",
      label: "Project knowledge",
      icon: { ios: "lightbulb", android: "auto_awesome" },
      count: candidates,
      detail:
        candidates === 0
          ? "Nothing proposed"
          : candidates === 1
            ? "1 finding to keep or dismiss"
            : `${candidates} findings to keep or dismiss`,
      tone: "knowledge",
    },
  ],
};
