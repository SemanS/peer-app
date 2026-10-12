// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - the shared fixture is read from the repository.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { effectiveOwner } from "./rules.ts";

/** The cases of who owns what, which the Hub and both apps' runtimes run as they are. */
const fixture = JSON.parse(
  NodeFS.readFileSync(
    NodePath.resolve(
      import.meta.dirname,
      "../../../../../..",
      "packages/client-runtime/src/peer/ownership.fixtures.json",
    ),
    "utf8",
  ),
) as {
  readonly taskOwners: ReadonlyArray<{
    readonly name: string;
    readonly map: { readonly areas: Record<string, string> };
    readonly members: ReadonlyArray<string>;
    readonly task: { readonly id: string; readonly area: string | null };
    readonly row: { readonly owner: string } | null;
    readonly expect: { readonly owner: string | null; readonly throughArea: boolean };
  }>;
};

describe("a task's effective owner", () => {
  it("is the fixture's, case by case", () => {
    expect(fixture.taskOwners.length).toBeGreaterThan(5);
    for (const found of fixture.taskOwners) {
      const owner = effectiveOwner(
        { area: found.task.area ?? undefined },
        found.row ?? undefined,
        found.map,
        new Set(found.members),
      );
      expect(owner?.owner ?? null, found.name).toBe(found.expect.owner);
      if (owner !== undefined) expect(owner.throughArea, found.name).toBe(found.expect.throughArea);
    }
  });
});
