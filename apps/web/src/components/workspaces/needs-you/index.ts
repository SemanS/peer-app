import type { PeerWebPlugin } from "../slots.types";
import { AlertsControl } from "./AlertsControl";
export const needsYouWebPlugin: PeerWebPlugin = { id: "needs-you", settings: AlertsControl };
