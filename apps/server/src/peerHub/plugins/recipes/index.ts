import {
  PeerHubError,
  PEER_RECIPES_PLUGIN,
  PEER_RECIPES_METHODS,
  RecipesRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ThreadManagementService } from "../../../orchestration-v2/ThreadManagementService.ts";
import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import { recipeStartLine } from "./catalog.ts";
import { recipeCommand } from "./cli.ts";
import { recipeMcp } from "./mcp.ts";
import { installCodexRecipeSkill } from "./codexSkill.ts";
import { RecipeService, layer } from "./RecipeService.ts";
export const RecipesPlugin = bindPlugin({
  ...PEER_RECIPES_PLUGIN,
  id: "recipes",
  commandNames: ["recipe"],
  layer,
  make: Effect.gen(function* () {
    const service = yield* RecipeService;
    return {
      adapterFiles: ({ codexHomes, peerScript, install }) =>
        Effect.tryPromise({
          try: () =>
            Promise.all(
              codexHomes.map((home) => installCodexRecipeSkill(home, peerScript, install)),
            ),
          catch: () => new PeerHubError({ detail: "The recipe skill could not be updated." }),
        }).pipe(Effect.asVoid),
      commands: [recipeCommand(service)],
      hooks: {
        startLine: service.available.pipe(Effect.map(({ recipes }) => recipeStartLine(recipes))),
      },
      ...recipeMcp(service),
      mcp: Layer.effectDiscard(
        Effect.gen(function* () {
          service.bindThreads(yield* ThreadManagementService);
        }),
      ),
      rpc: {
        group: RecipesRpcGroup,
        handlers: (wrap) =>
          RecipesRpcGroup.of({
            [PEER_RECIPES_METHODS.peerRecipesList]: () =>
              wrap.effect(PEER_RECIPES_METHODS.peerRecipesList, service.list),
            [PEER_RECIPES_METHODS.peerRecipesSend]: (input) =>
              wrap.effect(PEER_RECIPES_METHODS.peerRecipesSend, service.send(input)),
          }),
      },
      turnOff: service.forget,
      workspaceCleanup: () => service.forget,
    } satisfies PeerContributions;
  }),
});
