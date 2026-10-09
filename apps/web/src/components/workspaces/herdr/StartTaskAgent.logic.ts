import { requestStartInput } from "@t3tools/client-runtime/peer/requests";
import type { PeerAgentRequest } from "@t3tools/contracts";
export const startInput = (request: PeerAgentRequest | undefined, text: string) =>
  request === undefined ? { prompt: text.trim() } : requestStartInput(request, text);
