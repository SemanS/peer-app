import type { PeerMobilePlugin } from "../slotTypes";
import { MemorySettingsRow } from "./MemorySettingsRow";

/** Memory: the Settings row that opens shared findings, evidence and questions. */
export const memoryMobilePlugin: PeerMobilePlugin = {
  id: "memory",
  settingsRows: MemorySettingsRow,
  // Shared findings, evidence and questions stay there even when nothing waits.
  projectSignals: () => [
    {
      id: "memory",
      label: "Memory",
      icon: "brain",
      count: null,
      detail: "Findings, evidence, questions",
      tone: "knowledge",
    },
  ],
};
