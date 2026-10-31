// @effect-diagnostics nodeBuiltinImport:off - a real folder, for what the file system says of it.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

import { rootHolding } from "./runRoots.ts";

describe("rootHolding", () => {
  const base = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "roots-")));
  const site = NodePath.join(base, "site");
  NodeFS.mkdirSync(site);
  const entry = { project: "site", repository: "app", task: "t", root: site };

  it("finds a file that does not exist yet, and the folder itself", () => {
    assert.strictEqual(rootHolding([entry], NodePath.join(site, "src/new.ts")), entry);
    assert.strictEqual(rootHolding([entry], site), entry);
  });

  it("does not take a neighbour with the same prefix", () => {
    assert.strictEqual(rootHolding([entry], `${site}-2/a.ts`), undefined);
  });
});
