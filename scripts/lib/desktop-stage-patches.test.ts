import { assert, describe, it } from "@effect/vitest";

import { createStagePatchedDependencies } from "./desktop-stage-patches.ts";

const patches = {
  "@cursor/sdk@1.0.40": "patches/cursor.patch",
  "zod@3.25.76": "patches/zod3.patch",
  "zod@4.6.6": "patches/zod4.patch",
  "optional-native@2.0.0": "patches/native.patch",
  "expo@58.0.14": "patches/expo.patch",
};

function lockfile() {
  return {
    lockfileVersion: "9.0",
    importers: {
      "apps/server": {
        dependencies: {
          "@cursor/sdk": { specifier: "1.0.40", version: "1.0.40(zod@4.6.6)" },
          legacy: { specifier: "1.0.0", version: "1.0.0" },
        },
      },
      "apps/desktop": { dependencies: {} },
    },
    snapshots: {
      "@cursor/sdk@1.0.40(zod@4.6.6)": { dependencies: { helper: "1.0.0" } },
      "helper@1.0.0": { dependencies: { zod: "4.6.6(patch_hash=fixed)" } },
      "zod@4.6.6(patch_hash=fixed)": {},
      "legacy@1.0.0": { dependencies: { zod: "3.25.76" } },
      "zod@3.25.76": {},
      "optional-native@2.0.0": {},
      "expo@58.0.14": {},
    },
  };
}

describe("desktop stage dependency patches", () => {
  it("retains a transitive patched version without unrelated major versions or mobile patches", () => {
    assert.deepStrictEqual(
      createStagePatchedDependencies(patches, { "@cursor/sdk": "1.0.40" }, lockfile()),
      {
        "@cursor/sdk@1.0.40": "patches/cursor.patch",
        "zod@4.6.6": "patches/zod4.patch",
      },
    );
  });

  it("keeps both versions when separate staged roots really require both", () => {
    assert.deepStrictEqual(
      createStagePatchedDependencies(
        patches,
        { "@cursor/sdk": "1.0.40", legacy: "1.0.0" },
        lockfile(),
      ),
      {
        "@cursor/sdk@1.0.40": "patches/cursor.patch",
        "zod@3.25.76": "patches/zod3.patch",
        "zod@4.6.6": "patches/zod4.patch",
      },
    );
  });

  it("follows optional dependencies and terminates shared cyclic paths", () => {
    const graph = lockfile();
    const snapshots = {
      ...graph.snapshots,
      "helper@1.0.0": {
        dependencies: { zod: "4.6.6(patch_hash=fixed)", "@cursor/sdk": "1.0.40(zod@4.6.6)" },
        optionalDependencies: { "optional-native": "2.0.0" },
      },
    };
    assert.deepStrictEqual(
      createStagePatchedDependencies(patches, { "@cursor/sdk": "1.0.40" }, { ...graph, snapshots }),
      {
        "@cursor/sdk@1.0.40": "patches/cursor.patch",
        "zod@4.6.6": "patches/zod4.patch",
        "optional-native@2.0.0": "patches/native.patch",
      },
    );
  });

  it("seeds exact synthetic platform packages without adding unrelated importer roots", () => {
    const graph = lockfile();
    const snapshots = { ...graph.snapshots, "mobile@file:apps/mobile/deps/mobile.tgz": {} };
    assert.deepStrictEqual(
      createStagePatchedDependencies(
        patches,
        { "optional-native": "2.0.0" },
        { ...graph, snapshots },
      ),
      { "optional-native@2.0.0": "patches/native.patch" },
    );
  });

  it("uses the specified importer when the same name has different bound versions", () => {
    const graph = lockfile();
    graph.importers["apps/desktop"].dependencies = {
      legacy: { specifier: "2.0.0", version: "2.0.0" },
    };
    const snapshots = {
      ...graph.snapshots,
      "legacy@2.0.0": { dependencies: { zod: "4.6.6(patch_hash=fixed)" } },
    };
    assert.deepStrictEqual(
      createStagePatchedDependencies(patches, { legacy: "2.0.0" }, { ...graph, snapshots }, [
        "apps/desktop",
      ]),
      { "zod@4.6.6": "patches/zod4.patch" },
    );
  });

  it("rejects a staged root absent from its importer and exact snapshot", () => {
    assert.throws(
      () => createStagePatchedDependencies(patches, { missing: "^1.0.0" }, lockfile()),
      /missing.*root|root.*missing/i,
    );
  });

  it("rejects missing ordinary and optional snapshot references", () => {
    for (const edge of ["dependencies", "optionalDependencies"]) {
      const graph = lockfile();
      const snapshots = { ...graph.snapshots, "helper@1.0.0": { [edge]: { missing: "1.0.0" } } };
      assert.throws(
        () =>
          createStagePatchedDependencies(
            patches,
            { "@cursor/sdk": "1.0.40" },
            { ...graph, snapshots },
          ),
        /missing@1\.0\.0/,
      );
    }
  });

  it("rejects malformed graph data and an exact root that disagrees with the lock", () => {
    assert.throws(() =>
      createStagePatchedDependencies(patches, { "@cursor/sdk": "1.0.40" }, { snapshots: {} }),
    );
    assert.throws(
      () => createStagePatchedDependencies(patches, { "@cursor/sdk": "1.0.41" }, lockfile()),
      /1\.0\.41.*1\.0\.40|1\.0\.40.*1\.0\.41/,
    );
  });
});
