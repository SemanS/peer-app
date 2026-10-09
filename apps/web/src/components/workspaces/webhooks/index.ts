import type { PeerWebPlugin } from "../slots.types";
import { PeerWebhooks } from "./PeerWebhooks";
export const webhooksWebPlugin: PeerWebPlugin = { id: "webhooks", settings: PeerWebhooks };
