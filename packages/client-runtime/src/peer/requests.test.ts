import { describe, expect, it } from "vite-plus/test";
import type { PeerAgentRequest, PeerHubStatus } from "@t3tools/contracts";
import { incomingPeerRequests } from "./requests.ts";
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
