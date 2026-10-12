import { incomingPeerRequests } from "@t3tools/client-runtime/peer/requests";

import type { PeerWebPlugin } from "../slots.types";
import { SendIcon } from "lucide-react";
import { RequestsInbox, RequestTeammateDialog } from "./TeamRequests";
import { RequestNotifier } from "./RequestNotifier";

/** Team requests: asking a teammate to take a task, and the requests waiting on you. */
export const requestsWebPlugin: PeerWebPlugin = {
  id: "requests",
  background: RequestNotifier,
  needsYou: {
    count: (status) => incomingPeerRequests(status).length,
    Component: RequestsInbox,
  },
  projectActions: [
    {
      id: "request-teammate",
      label: "Request a teammate…",
      hint: "Ask someone to take on a task",
      icon: SendIcon,
      Dialog: RequestTeammateDialog,
    },
  ],
};
