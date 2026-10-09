import type { PeerWebhookList } from "@t3tools/contracts";
import { orderWebhooks } from "@t3tools/client-runtime/peer/webhooks";

export function webhooksView(
  role: string,
  query: {
    readonly data: PeerWebhookList | null;
    readonly error: string | null;
    readonly isPending: boolean;
  },
) {
  if (role !== "owner" && role !== "admin") return null;
  if (query.error) return { kind: "error", message: query.error } as const;
  if (!query.data) return { kind: "loading" } as const;
  if (!query.data.webhooks.length) return { kind: "empty" } as const;
  return { kind: "ready", rows: orderWebhooks(query.data.webhooks) } as const;
}
