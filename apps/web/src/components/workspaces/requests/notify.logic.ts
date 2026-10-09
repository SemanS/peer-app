import { incomingPeerRequests } from "@t3tools/client-runtime/peer/requests";
import type { PeerHubStatus, PeerAgentRequest } from "@t3tools/contracts";
export type RequestNoticeStatus = {
  readonly signedIn: boolean;
  readonly email: string | null;
  readonly requests?: PeerHubStatus["requests"];
  readonly plugins?: ReadonlyArray<{ readonly id: string; readonly active: boolean }> | undefined;
};
export type RequestNoticeRow = { readonly workspace: string; readonly request: PeerAgentRequest };
export const requestKey = (row: RequestNoticeRow) => `${row.workspace}/${row.request.id}`;
export function makeRequestObserver() {
  const seeded = new Map<string, string>(),
    seen = new Set<string>();
  return {
    observe(environment: string, status: RequestNoticeStatus | null) {
      if (
        !status?.signedIn ||
        status.email === null ||
        status.requests === undefined ||
        status.plugins?.find((p) => p.id === "requests")?.active === false
      ) {
        seeded.delete(environment);
        return [];
      }
      const rows = incomingPeerRequests(status),
        fresh = seeded.get(environment) === status.email;
      seeded.set(environment, status.email);
      const arrived: RequestNoticeRow[] = [];
      for (const row of rows) {
        const key = requestKey(row);
        if (fresh && !seen.has(key)) arrived.push(row);
        seen.add(key);
      }
      return arrived;
    },
  };
}
export function batchNotice(rows: ReadonlyArray<RequestNoticeRow>) {
  const row = rows[0];
  return rows.length === 1 && row !== undefined
    ? { title: "Team request", body: `${row.request.sender}: ${row.request.title}`.slice(0, 300) }
    : {
        title: `${rows.length} team requests`,
        body: "Open Work to review the requests waiting on you.",
      };
}
export function stillPending(
  batch: ReadonlyArray<RequestNoticeRow>,
  statuses: ReadonlyArray<RequestNoticeStatus | null>,
) {
  const keys = new Set(statuses.flatMap((status) => incomingPeerRequests(status).map(requestKey)));
  return batch.filter((row) => keys.has(requestKey(row)));
}
export const noticeEnabled = (mode: string, inApp: boolean) => mode !== "off" || inApp;
