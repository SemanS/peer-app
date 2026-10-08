import type { PeerMobilePlugin } from "../slots";
import { MemorySettingsRow } from "./MemorySettingsRow";

/** Memory: the Settings row that opens shared findings, evidence and questions. */
export const memoryMobilePlugin: PeerMobilePlugin = {
  id: "memory",
  settingsRows: MemorySettingsRow,
};
