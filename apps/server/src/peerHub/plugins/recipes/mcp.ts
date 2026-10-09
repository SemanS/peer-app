import * as Effect from "effect/Effect";
import { type PeerContributions, usage } from "../../core/plugin.ts";
import { renderRecipe } from "./catalog.ts";
import type { RecipeService } from "./RecipeService.ts";
export const recipeMcp = (
  service: RecipeService["Service"],
): Pick<PeerContributions, "agentTools" | "agentPrompts"> => ({
  agentTools: [
    {
      name: "peer_recipe",
      description: "List or read a Peer recipe; this only prints the procedure.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" }, input: { type: "string", maxLength: 4000 } },
        additionalProperties: false,
      },
      command: "recipe",
      arguments: (args) => {
        if (
          Object.keys(args).some((key) => key !== "name" && key !== "input") ||
          (args.name !== undefined && typeof args.name !== "string") ||
          (args.input !== undefined &&
            (typeof args.input !== "string" || args.input.length > 4000)) ||
          (args.input !== undefined && args.name === undefined)
        )
          throw usage(
            "Invalid recipe arguments",
            "give an optional name and input of at most 4000 characters.",
          );
        return typeof args.name === "string"
          ? [args.name, ...(typeof args.input === "string" ? [args.input] : [])]
          : [];
      },
    },
  ],
  agentPrompts: {
    list: () =>
      service.available.pipe(
        Effect.map(({ recipes }) =>
          recipes.map((r) => ({
            name: r.name,
            description: r.title,
            arguments: [{ name: "input", description: r.hint ?? "Your words", required: false }],
          })),
        ),
      ),
    get: (_session, name, args) =>
      service.available.pipe(
        Effect.flatMap(({ recipes }) =>
          Effect.try({
            try: () => {
              const recipe = recipes.find((r) => r.name === name);
              if (!recipe) throw usage("Recipe is not available", "list Peer prompts again.");
              if (Object.keys(args).some((key) => key !== "input"))
                throw usage("Unknown recipe argument", "use input only.");
              return { description: recipe.title, text: renderRecipe(recipe, args.input, "mcp") };
            },
            catch: (failure) => failure as import("../../core/plugin.ts").CliError,
          }),
        ),
      ),
  },
});
