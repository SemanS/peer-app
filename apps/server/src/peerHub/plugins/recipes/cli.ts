import * as Effect from "effect/Effect";
import { type PeerCommand, CliError, usage } from "../../core/plugin.ts";
import { recipeList, renderRecipe } from "./catalog.ts";
import type { RecipeService } from "./RecipeService.ts";
export const recipeCommand = (service: RecipeService["Service"]): PeerCommand => {
  const read: NonNullable<PeerCommand["globalRead"]> = (args, { tools }) =>
    service.available.pipe(
      Effect.flatMap(({ enabled, recipes }) =>
        Effect.try({
          try: () => {
            if (!enabled)
              throw usage(
                "Recipes are turned off here",
                "ask your person to enable Recipes in Settings → Peer → Coordination & plugins.",
              );
            const [name, ...words] = args;
            if (name === undefined) return recipeList(recipes);
            const recipe = recipes.find((r) => r.name === name);
            if (!recipe)
              throw usage(
                `recipe ${name} is not available`,
                `available recipes: ${recipes.map((r) => r.name).join(", ") || "none"}. Run peer recipe.`,
              );
            return renderRecipe(recipe, words.join(" "), tools ? "mcp" : "cli");
          },
          catch: (failure) =>
            failure instanceof CliError
              ? failure
              : usage("Recipe could not be read", "run peer recipe."),
        }),
      ),
    );
  return {
    name: "recipe",
    usage: 'recipe [<name> ["<input>"]]',
    summary: "list or print an agent procedure",
    globalRead: read,
    run: ({ args }) => read(args, { tools: false }),
  };
};
