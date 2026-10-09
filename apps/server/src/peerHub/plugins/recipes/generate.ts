// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - build-time recipe generator, never runtime file loading.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { parse } from "yaml";
import { PEER_PLUGIN_IDS } from "@t3tools/contracts";
export interface Recipe {
  readonly name: string;
  readonly title: string;
  readonly hint?: string;
  readonly access: "read" | "write";
  readonly requires: ReadonlyArray<string>;
  readonly body: string;
}
const chars = (s: string) => [...s].length;
export function parseRecipe(name: string, source: string): Recipe {
  const fail = (problem: string): never => {
    throw new Error(`${name}: ${problem}`);
  };
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name) || chars(name) > 40)
    fail("invalid kebab-case name");
  const normalized = source.replaceAll("\r\n", "\n");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(normalized);
  if (!match) return fail("front matter required");
  const data: unknown = parse(match[1]!);
  if (data === null || typeof data !== "object" || Array.isArray(data))
    return fail("front matter must be an object");
  const meta = data as Record<string, unknown>;
  for (const key of Object.keys(meta))
    if (!["title", "hint", "access", "requires"].includes(key)) fail(`unknown key ${key}`);
  if (
    typeof meta.title !== "string" ||
    !meta.title.trim() ||
    chars(meta.title) > 60 ||
    /[\r\n]/.test(meta.title)
  )
    return fail("title must be one line, 1 to 60 characters");
  if (meta.hint !== undefined && (typeof meta.hint !== "string" || /[\r\n]/.test(meta.hint)))
    return fail("hint must be one line");
  if (meta.access !== "read" && meta.access !== "write")
    return fail("access must be read or write");
  const requires = meta.requires ?? [];
  if (
    !Array.isArray(requires) ||
    !requires.every(
      (id): id is string =>
        typeof id === "string" && (PEER_PLUGIN_IDS as readonly string[]).includes(id),
    )
  )
    return fail("requires must name known plugins");
  const body = match[2]!.trim();
  if (chars(body) > 2400) fail("body exceeds 2400 characters");
  if ((body.match(/\{\{input\}\}/g) ?? []).length !== 1) fail("body needs exactly one {{input}}");
  return {
    name,
    title: meta.title,
    ...(typeof meta.hint === "string" ? { hint: meta.hint } : {}),
    access: meta.access,
    requires,
    body,
  };
}
export function generate(sources: ReadonlyArray<{ readonly name: string; readonly text: string }>) {
  const names = new Set<string>();
  const rows = sources
    .map(({ name, text }) => {
      if (names.has(name)) throw new Error(`${name}: duplicate name`);
      names.add(name);
      return parseRecipe(name, text);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    '// Generated; do not edit. Regenerate: pnpm recipes:generate in apps/server.\nimport type { Recipe } from "./generate.ts";\nexport const recipeTable: ReadonlyArray<Recipe> = ' +
    JSON.stringify(rows, null, 2) +
    ";\n"
  );
}
export const sourcesAt = async (directory: string) =>
  Promise.all(
    (await NodeFSP.readdir(directory))
      .filter((n) => n.endsWith(".md"))
      .sort()
      .map(async (name) => ({
        name: name.slice(0, -3),
        text: await NodeFSP.readFile(NodePath.join(directory, name), "utf8"),
      })),
  );
if (
  process.argv[1] &&
  NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url)
) {
  const file = NodePath.join(import.meta.dirname, "recipeTable.generated.ts");
  const output = generate(await sourcesAt(NodePath.join(import.meta.dirname, "recipes")));
  if (process.argv.includes("--check")) {
    if ((await NodeFSP.readFile(file, "utf8").catch(() => "")) !== output) {
      process.stderr.write("Recipe table differs; regenerate it.\n");
      process.exitCode = 1;
    }
  } else await NodeFSP.writeFile(file, output);
}
