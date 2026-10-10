import type { PeerMobilePlugin } from "../slotTypes";

/**
 * Knowledge: what agents found that a project may keep. The phone shows how much waits; keeping
 * or dismissing it happens on web or desktop.
 */
export const knowledgeMobilePlugin: PeerMobilePlugin = {
  id: "knowledge",
  projectSignals: (_status, { candidates }) => [
    {
      id: "knowledge",
      label: "Knowledge to keep",
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
