import { usage } from "../../core/plugin.ts";
import type { Recipe } from "./generate.ts";
import { recipeTable } from "./recipeTable.generated.ts";
export const MCP_MAPPING =
  "MCP: use peer_<command> tools with the same arguments where available, such as peer_status and peer_context. Other recipe commands need the peer CLI; if it is unavailable, ask your person.";
export const availableRecipes = (on: (id: string) => boolean) =>
  on("recipes") ? recipeTable.filter((r) => r.requires.every(on)) : [];
export function renderRecipe(recipe: Recipe, input = "", host: "cli" | "mcp" = "cli") {
  if (input.length > 4000)
    throw usage(
      "Recipe input exceeds 4000 characters",
      "shorten the input and run peer recipe again.",
    );
  const words = [...input]
    .filter((c) => {
      const n = c.codePointAt(0)!;
      return c === "\n" || c === "\t" || (n > 31 && (n < 127 || n > 159));
    })
    .join("")
    .trim();
  const text = `Peer: recipe ${recipe.name}\n\n${recipe.body.replace("{{input}}", () => words || "none given; ask your person for what is missing")}`;
  return host === "mcp" ? text + "\n\n" + MCP_MAPPING : text;
}
export const recipeList = (recipes: ReadonlyArray<Recipe>) =>
  [
    ...recipes.map((r) => `${r.name}  ${r.title}${r.access === "read" ? "  (reads only)" : ""}`),
    'Print a procedure: peer recipe <name> "<input>".',
  ].join("\n");
export const recipeStartLine = (recipes: ReadonlyArray<Recipe>) =>
  recipes.length
    ? `Peer recipes: ${recipes.map((r) => r.name).join(", ")}. Print one with peer recipe <name> "<input>" and follow it.`
    : null;
