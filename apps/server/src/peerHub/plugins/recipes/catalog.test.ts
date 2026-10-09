// @effect-diagnostics nodeBuiltinImport:off - drift check reads only the committed recipe sources.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { expect, it } from "@effect/vitest";
import { availableRecipes, renderRecipe, recipeStartLine, MCP_MAPPING } from "./catalog.ts";
import { generate, sourcesAt } from "./generate.ts";
import { recipeTable } from "./recipeTable.generated.ts";
import { askedByPerson } from "../../peerText.ts";
it("keeps interpolation literal, refuses over-budget input and derives all availability once", () => {
  const on = new Set(["recipes", "requests", "announcements", "dependencies"]);
  const rows = availableRecipes((id) => on.has(id));
  expect(rows).toHaveLength(7);
  const recipe = rows.find((r) => r.name === "handoff")!;
  for (const input of ["$&", "$1", "{{input}}", "one\n\ttwo"])
    expect(renderRecipe(recipe, input)).toContain(`Input: ${input}`);
  expect(renderRecipe(recipe, " \u0000\u0001 ")).toContain("none given; ask your person");
  expect(() => renderRecipe(recipe, "x".repeat(4001))).toThrow("4000");
  for (const row of rows) expect(askedByPerson(renderRecipe(row, "").split("\n")[0]!)).toBe(false);
  expect(renderRecipe(recipe, "words", "mcp")).toBe(
    renderRecipe(recipe, "words") + "\n\n" + MCP_MAPPING,
  );
  expect(recipeStartLine(rows)!.length).toBeLessThanOrEqual(300);
  for (const row of rows) expect(recipeStartLine(rows)).toContain(row.name);
  on.delete("requests");
  expect(availableRecipes((id) => on.has(id)).some((r) => r.name === "handoff")).toBe(false);
  on.delete("recipes");
  expect(availableRecipes((id) => on.has(id))).toEqual([]);
  expect(recipeStartLine([])).toBeNull();
});
it("checks every shape, read-only sentence and state-before-release handoff ordering", () => {
  const handoff = recipeTable.find((r) => r.name === "handoff")!.body;
  expect(handoff.indexOf("Write what is done")).toBeLessThan(
    handoff.indexOf("Check that it was saved"),
  );
  expect(handoff.indexOf("STOP")).toBeLessThan(handoff.indexOf("`peer release`"));
  expect(handoff.indexOf("`peer release`")).toBeLessThan(handoff.indexOf("`peer request"));
  expect(handoff).toContain("Do not run `peer review` or `peer done`");
  for (const row of recipeTable) {
    expect([...row.body].length).toBeLessThanOrEqual(2400);
    expect([...row.title].length).toBeLessThanOrEqual(60);
    expect(row.body.match(/\{\{input\}\}/g)).toHaveLength(1);
    if (row.access === "read")
      expect(row.body).toContain(
        "This procedure only reads: report what you found and ask your person before changing anything.",
      );
  }
});
it("rejects generated drift including added or removed source files", async () => {
  const sources = await sourcesAt(NodePath.join(import.meta.dirname, "recipes"));
  const committed = await NodeFSP.readFile(
    NodePath.join(import.meta.dirname, "recipeTable.generated.ts"),
    "utf8",
  );
  expect(generate(sources)).toBe(committed);
  expect(sources.map((s) => s.name)).toEqual(recipeTable.map((r) => r.name));
});
