// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - the shared fixture is read from the repository.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  covers,
  effectiveOwner,
  generated,
  matches,
  ownerDecides,
  ownerToAsk,
  pathOwner,
} from "./client/rules.ts";

interface FixtureMap {
  readonly areas: Record<string, string>;
  readonly paths: Record<string, string>;
  readonly decide: ReadonlyArray<string>;
}

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
    readonly map: Pick<FixtureMap, "areas">;
    readonly members: ReadonlyArray<string>;
    readonly task: { readonly id: string; readonly area: string | null };
    readonly row: { readonly owner: string } | null;
    readonly expect: { readonly owner: string | null; readonly throughArea: boolean };
  }>;
  readonly pathOwners: ReadonlyArray<{
    readonly name: string;
    readonly map: FixtureMap;
    readonly path: string;
    readonly expect: {
      readonly owner: string | null;
      readonly pattern: string | null;
      readonly decides: boolean;
    };
  }>;
  readonly asks: ReadonlyArray<{
    readonly name: string;
    readonly map: FixtureMap;
    readonly person: string;
    readonly path: string;
    readonly expect: { readonly ask: string | null };
  }>;
  readonly coverage: ReadonlyArray<{
    readonly name: string;
    readonly call: {
      readonly state: string;
      readonly task: string | null;
      readonly session: string;
      readonly environment: string;
      readonly email: string;
      readonly paths: ReadonlyArray<string>;
    };
    readonly session: {
      readonly id: string;
      readonly environment: string;
      readonly email: string;
      readonly task: string | null;
    };
    readonly path: string;
    readonly expect: { readonly covers: boolean };
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

describe("the owner of a path", () => {
  it("is the fixture's, the most specific pattern's, case by case", () => {
    expect(fixture.pathOwners.length).toBeGreaterThan(15);
    for (const found of fixture.pathOwners) {
      const owner = pathOwner(found.map, found.path);
      expect(owner?.owner ?? null, found.name).toBe(found.expect.owner);
      expect(owner?.pattern ?? null, found.name).toBe(found.expect.pattern);
      expect(ownerDecides(found.map, found.path), found.name).toBe(found.expect.decides);
    }
  });

  it("matches as coordination path patterns do", () => {
    expect(matches("src/**", "src/a/b.ts")).toBe(true);
    expect(matches("src/**", "src")).toBe(true);
    expect(matches("src/*.ts", "src/a/b.ts")).toBe(false);
    expect(matches("src/payments/**", "src/payments/")).toBe(true);
    expect(matches("**/fees.ts", "src/payments/fees.ts")).toBe(true);
    expect(matches("src/Payments/**", "src/payments/fees.ts")).toBe(false);
  });
});

describe("whom an agent has to ask", () => {
  it("is the fixture's, case by case", () => {
    expect(fixture.asks.length).toBeGreaterThan(5);
    for (const found of fixture.asks)
      expect(ownerToAsk(found.map, found.person, found.path) ?? null, found.name).toBe(
        found.expect.ask,
      );
  });
});

describe("what an owner's call covers", () => {
  it("is the fixture's, case by case", () => {
    expect(fixture.coverage.length).toBeGreaterThan(15);
    for (const found of fixture.coverage)
      expect(
        covers(
          { ...found.call, task: found.call.task ?? undefined },
          { ...found.session, task: found.session.task ?? undefined },
          found.path,
        ),
        found.name,
      ).toBe(found.expect.covers);
  });
});

describe("generated files", () => {
  it("are nobody's, whichever folder they are in", () => {
    for (const path of ["package-lock.json", "web/pnpm-lock.yaml", "a/b/Cargo.lock", ".DS_Store"])
      expect(generated(path), path).toBe(true);
    for (const path of ["package.json", "src/lock.ts", "Cargo.toml"])
      expect(generated(path), path).toBe(false);
  });
});
