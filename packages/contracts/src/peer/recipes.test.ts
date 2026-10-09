import { expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { PeerRecipeSendInput, PeerRecipeName, RecipesRpcGroup } from "./recipes.ts";
const decode = Schema.decodeUnknownSync(PeerRecipeSendInput);
const decodeName = Schema.decodeUnknownSync(PeerRecipeName);
it("only accepts bounded recipe input and known local targets, never client-authored recipe text", () => {
  const input = {
    target: { kind: "herdr", agentId: "a" },
    recipe: "catch-up",
    input: "read",
    op: "once",
    text: "different procedure",
  };
  expect(decode(input)).toEqual({
    target: input.target,
    recipe: input.recipe,
    input: input.input,
    op: input.op,
  });
  expect(() => decode({ ...input, input: "x".repeat(4001) })).toThrow();
  expect(() => decode({ ...input, target: { kind: "observe", agentId: "a" } })).toThrow();
  expect(() => decodeName("Bad_Name")).toThrow();
  expect([...RecipesRpcGroup.requests.keys()]).toEqual(["peer.recipes.list", "peer.recipes.send"]);
});
