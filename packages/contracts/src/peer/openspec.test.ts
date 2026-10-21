import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { AuthFilesystemReadScope } from "../auth.ts";
import { PeerOpenSpecReadInput, PeerOpenSpecReadResult } from "./openspec.ts";
import { PEER_OPENSPEC_METHODS } from "./openspec.rpc.ts";
import { PEER_RPC_SCOPES } from "./rpcRegistry.ts";

it("bounds task, project, repository and workspace identifiers at the read boundary", () => {
  const isInput = Schema.is(PeerOpenSpecReadInput);
  const input = { workspace: "team", projectId: "app", taskId: "task" };
  expect(isInput(input)).toBe(true);
  for (const key of ["workspace", "projectId", "taskId", "repositoryId"])
    expect(isInput({ ...input, [key]: "x".repeat(201) })).toBe(false);
  expect(PEER_RPC_SCOPES[PEER_OPENSPEC_METHODS.peerOpenSpecRead]).toBe(AuthFilesystemReadScope);
});
it("distinguishes unlinked tasks from unavailable sources on every client", () => {
  const decode = Schema.decodeUnknownSync(PeerOpenSpecReadResult);
  expect(
    decode({ state: "unavailable", code: "not-linked", reason: "No matching change." }),
  ).toMatchObject({ code: "not-linked" });
  expect(() => decode({ state: "unavailable", reason: "Unknown" })).toThrow();
});
