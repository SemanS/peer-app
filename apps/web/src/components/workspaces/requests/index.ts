import { incomingPeerRequests } from "@t3tools/client-runtime/peer/requests";

import type { PeerWebPlugin } from "../slots.types";
import { RequestsInbox, RequestTeammate } from "./TeamRequests";

/** Team requests: asking a teammate to take a task, and the requests waiting on you. */
export const requestsWebPlugin: PeerWebPlugin = {
  id: "requests",
  needsYou: {
    count: (status) => incomingPeerRequests(status).length,
    Component: RequestsInbox,
  },
  projectActions: RequestTeammate,
};
