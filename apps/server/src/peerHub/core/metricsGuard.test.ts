// @effect-diagnostics nodeBuiltinImport:off - static catalog guard.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { it, expect } from "vite-plus/test";
import { CATALOG } from "./metricsCatalog.ts";
it("declares every broker event, leaves one sink and keeps content-shaped catalog fields typed safely", async () => {
  const root = NodePath.resolve(import.meta.dirname, "..");
  async function walk(dir: string): Promise<string[]> {
    const entries = await NodeFSP.readdir(dir, { withFileTypes: true });
    return (
      await Promise.all(
        entries.map((e) =>
          e.isDirectory()
            ? walk(NodePath.join(dir, e.name))
            : Promise.resolve([NodePath.join(dir, e.name)]),
        ),
      )
    ).flat();
  }
  for (const file of await walk(root)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const source = await NodeFSP.readFile(file, "utf8");
    for (const match of source.matchAll(/\.record\("([^"]+)"/g))
      expect(Object.hasOwn(CATALOG, match[1]!)).toBe(true);
    if (!file.endsWith("/metricsLog.ts"))
      expect(source).not.toMatch(/appendFile\([^\n]*coordination/);
  }
  for (const fields of Object.values(CATALOG))
    for (const [name, kind] of Object.entries(fields)) {
      if (
        /^(text|answer|args|out|files|paths|path|error|message|branch|cwd|root|transcript|goal|intent|resolution)$/.test(
          name,
        )
      )
        expect(["count", "bytes", "flag", "enum"]).toContain(
          typeof kind === "object" && "enum" in kind ? "enum" : kind,
        );
      if (/^(task|scope|entry|entries)$/.test(name)) expect(["id", "ids"]).not.toContain(kind);
    }
});
