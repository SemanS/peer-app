import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { ThreadId } from "../baseSchemas.ts";
import { PeerHubError } from "./base.ts";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
} from "../auth.ts";
export const PeerRecipeName = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
  Schema.isMaxLength(40),
);
export const PeerRecipeSummary = Schema.Struct({
  name: PeerRecipeName,
  title: Schema.String,
  hint: Schema.optional(Schema.String),
  access: Schema.Literals(["read", "write"]),
});
export type PeerRecipeSummary = typeof PeerRecipeSummary.Type;
export const PeerRecipesListResult = Schema.Struct({
  enabled: Schema.Boolean,
  recipes: Schema.Array(PeerRecipeSummary),
});
export type PeerRecipesListResult = typeof PeerRecipesListResult.Type;
export const PeerRecipeTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("herdr"), agentId: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("thread"), threadId: ThreadId }),
]);
export type PeerRecipeTarget = typeof PeerRecipeTarget.Type;
export const PeerRecipeSendInput = Schema.Struct({
  target: PeerRecipeTarget,
  recipe: PeerRecipeName,
  input: Schema.optional(Schema.String.check(Schema.isMaxLength(4000))),
  op: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
});
export type PeerRecipeSendInput = typeof PeerRecipeSendInput.Type;
export const PeerRecipeSendResult = Schema.Struct({
  delivery: Schema.Literals(["sent", "queued"]),
});
export type PeerRecipeSendResult = typeof PeerRecipeSendResult.Type;
export class PeerRecipesError extends Schema.TaggedError<PeerRecipesError>()("PeerRecipesError", {
  message: Schema.String,
}) {}
export const PEER_RECIPES_METHODS = {
  peerRecipesList: "peer.recipes.list",
  peerRecipesSend: "peer.recipes.send",
} as const;
export const RecipesRpcGroup = RpcGroup.make(
  Rpc.make(PEER_RECIPES_METHODS.peerRecipesList, {
    success: PeerRecipesListResult,
    error: Schema.Union([PeerRecipesError, PeerHubError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(PEER_RECIPES_METHODS.peerRecipesSend, {
    payload: PeerRecipeSendInput,
    success: PeerRecipeSendResult,
    error: Schema.Union([PeerRecipesError, PeerHubError, EnvironmentAuthorizationError]),
  }),
);
export const RecipesRpcScopes = {
  [PEER_RECIPES_METHODS.peerRecipesList]: AuthOrchestrationReadScope,
  [PEER_RECIPES_METHODS.peerRecipesSend]: AuthOrchestrationOperateScope,
} as const;
export const PEER_RECIPES_PLUGIN = {
  id: "recipes",
  title: "Agent recipes",
  summary: "One set of on-demand procedures for your own agents.",
  defaultEnabled: true,
} as const;
