import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { PeerHubStartAgentInput } from "../peerHub.ts";

const decode = Schema.decodeUnknownSync(PeerHubStartAgentInput);
const encode = Schema.encodeSync(PeerHubStartAgentInput);
const input = {
  workspace: "team",
  projectId: "app",
  taskId: "task",
  repositoryId: "app",
  harness: "codex" as const,
};
it("preserves the reviewed prompt through both wire directions", () => {
  const prompt = "\n  Keep this indentation.\n\n";
  expect(decode({ ...input, prompt }).prompt).toBe(prompt);
  expect(encode({ ...input, prompt }).prompt).toBe(prompt);
});
it("retains blank and length validation without changing prompt content", () => {
  expect(() => decode({ ...input, prompt: " \n\t " })).toThrow();
  expect(() => decode({ ...input, prompt: "x".repeat(20_001) })).toThrow();
  expect(decode(input).prompt).toBeUndefined();
});
