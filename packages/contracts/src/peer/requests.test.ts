import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { PeerAgentRequest } from "./requests.ts";
import { PeerHubStartAgentInput } from "../peerHub.ts";
const decodeRequest = Schema.decodeUnknownSync(PeerAgentRequest),
  decodeStart = Schema.decodeUnknownSync(PeerHubStartAgentInput);
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
