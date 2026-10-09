// @effect-diagnostics globalDate:off - expiry labels use explicit fixture timestamps.
import { describe, expect, it } from "vite-plus/test";
import type { PeerAgentRequest, PeerHubStatus } from "@t3tools/contracts";
import {
  incomingPeerRequests,
  requestOutcome,
  sentPeerRequests,
  canWithdraw,
  expiresIn,
  requestStartInput,
} from "./requests.ts";
const request: PeerAgentRequest = {
  id: "one",
  project: "app",
  task: "work",
  sender: "ana@test.sk",
  recipient: "bob@test.sk",
  title: "Download flows",
  prompt: "Pull GitHub",
  status: "pending",
  createdAt: "now",
  updatedAt: "now",
};
describe("request inbox", () => {
  it("shows only pending requests to the signed-in recipient regardless of environment", () => {
    const snapshot: Pick<PeerHubStatus, "signedIn" | "email" | "requests"> = {
      signedIn: true,
      email: "bob@test.sk",
      requests: [
        { workspace: "team", request },
        { workspace: "team", request: { ...request, id: "other", recipient: "eve@test.sk" } },
        { workspace: "team", request: { ...request, id: "resolved", status: "accepted" } },
      ],
    };
    expect(incomingPeerRequests(snapshot).map((r) => r.request.id)).toEqual(["one"]);
    expect(incomingPeerRequests({ ...snapshot, email: "ana@test.sk" })).toEqual([]);
    expect(incomingPeerRequests({ ...snapshot, signedIn: false })).toEqual([]);
    expect(incomingPeerRequests(null)).toEqual([]);
    expect(incomingPeerRequests({ ...snapshot, requests: undefined })).toEqual([]);
  });
});

describe("reversible requests", () => {
  it("keeps the wire statuses but words all closures, including future reasons", () => {
    expect(requestOutcome(request)).toBe("pending");
    expect(requestOutcome({ ...request, status: "accepted", closedBy: "sender" })).toBe("accepted");
    expect(requestOutcome({ ...request, status: "dismissed", closedBy: "sender" })).toBe(
      "withdrawn",
    );
    expect(requestOutcome({ ...request, status: "dismissed", closedBy: "expiry" })).toBe("expired");
    expect(requestOutcome({ ...request, status: "dismissed", closedBy: "future" })).toBe(
      "dismissed",
    );
  });
  it("orders the caller's project requests and only offers compatible withdrawal", () => {
    const pending = { ...request, expiresAt: "2026-10-23T00:00:00Z" };
    const closed = {
      ...pending,
      id: "closed",
      status: "accepted" as const,
      updatedAt: "2026-10-09",
    };
    const status = {
      signedIn: true,
      email: request.sender,
      requests: [
        { workspace: "team", request: closed },
        { workspace: "team", request: pending },
        { workspace: "other", request: pending },
        { workspace: "team", request: { ...pending, project: "else" } },
      ],
    };
    expect(
      sentPeerRequests(status, { workspace: "team", project: "app" }).map(
        ({ request }) => request.id,
      ),
    ).toEqual(["one", "closed"]);
    expect(canWithdraw(pending, request.sender)).toBe(true);
    for (const [row, email] of [
      [request, request.sender],
      [closed, request.sender],
      [pending, request.recipient],
    ] as const)
      expect(canWithdraw(row, email)).toBe(false);
  });
  it("words expiry from a supplied clock and never forwards a sender prompt", () => {
    const now = Date.parse("2026-10-09T00:00:00Z");
    for (const [days, text] of [
      [0, "today"],
      [1, "tomorrow"],
      [13, "13 days"],
    ] as const)
      expect(
        expiresIn({ ...request, expiresAt: new Date(now + days * 86400000).toISOString() }, now),
      ).toBe(text);
    expect(expiresIn(request, now)).toBeUndefined();
    expect(requestStartInput(request, "Review carefully")).toEqual({
      requestId: "one",
      instruction: "Review carefully",
    });
  });
});
