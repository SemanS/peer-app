import type { PeerWebPlugin } from "../slots.types";
import { ResumeControl } from "./ResumeControl";

/** Settle overlaps: its one switch, in Settings › This computer › Coordination & plugins. */
export const settleWebPlugin: PeerWebPlugin = { id: "settle", settings: ResumeControl };
