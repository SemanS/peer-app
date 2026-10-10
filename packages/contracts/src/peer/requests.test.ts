import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  PeerAgentRequest,
  PeerHubDismissRequestInput,
  PeerHubWithdrawRequestInput,
} from "./requests.ts";
import { PeerHubStartAgentInput } from "../peerHub.ts";
const decodeRequest = Schema.decodeUnknownSync(PeerAgentRequest),
  decodeStart = Schema.decodeUnknownSync(PeerHubStartAgentInput),
  decodeDismiss = Schema.decodeUnknownSync(PeerHubDismissRequestInput),
  // The previous dismissal input, as an older app server decodes it.
  decodeOlderDismiss = Schema.decodeUnknownSync(PeerHubWithdrawRequestInput);
const row = {
  id: "one",
  project: "app",
  task: "work",
  sender: "ana@test.sk",
  recipient: "bob@test.sk",
  title: "Flows",
  prompt: "Pull",
  status: "pending",
  createdAt: "now",
  updatedAt: "now",
};
describe("request wire compatibility", () => {
  it("keeps old rows and accepts future closure reasons", () => {
    expect(decodeRequest(row)).toEqual(row);
    const newer = {
      ...row,
      status: "dismissed",
      expiresAt: "2026-10-22",
      closedBy: "something-new",
      replayed: true,
    };
    expect(decodeRequest(newer)).toEqual(newer);
  });
  it("bounds recipient instructions without breaking legacy request starts", () => {
    const input = {
      workspace: "team",
      projectId: "app",
      taskId: "task",
      repositoryId: "repo",
      harness: "claude",
      requestId: "one",
    };
    expect(decodeStart({ ...input, instruction: "Check this" })).toHaveProperty(
      "instruction",
      "Check this",
    );
    expect(decodeStart({ ...input, prompt: "Old edited sender text" })).toHaveProperty("prompt");
    expect(() => decodeStart({ ...input, instruction: "x".repeat(2001) })).toThrow();
  });
});
describe("decline reason compatibility", () => {
  const place = { workspace: "team", projectId: "app", requestId: "one" };
  it("decodes a dismissal with and without a reason, trimmed and bounded", () => {
    expect(decodeDismiss(place)).toEqual(place);
    expect(decodeDismiss({ ...place, reason: "  Can it wait until Monday?  " })).toEqual({
      ...place,
      reason: "Can it wait until Monday?",
    });
    expect(() => decodeDismiss({ ...place, reason: "x".repeat(301) })).toThrow();
  });
  it("lets an older server read a dismissal with a reason, and a request row with one", () => {
    // The previous struct drops the new field.
    expect(decodeOlderDismiss({ ...place, reason: "No" })).toEqual(place);
    expect(
      decodeRequest({ ...row, status: "dismissed", reason: "On a release today" }),
    ).toHaveProperty("reason", "On a release today");
    expect(decodeRequest({ ...row, status: "dismissed" })).not.toHaveProperty("reason");
  });
});
