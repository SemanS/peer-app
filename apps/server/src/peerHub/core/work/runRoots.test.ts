// @effect-diagnostics nodeBuiltinImport:off - a real folder, for what the file system says of it.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

import { foldersBeyond, rootHolding, roomReach } from "./runRoots.ts";

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

describe("foldersBeyond", () => {
  const base = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "folders-")));
  const shared = NodePath.join(base, "shared");
  const alone = NodePath.join(base, "alone");
  NodeFS.mkdirSync(shared);
  NodeFS.mkdirSync(alone);
  const folders = [
    { name: "shared", folder: shared },
    { name: "alone", folder: alone },
  ];

  it("drops a project that has a checkout by now, so no agent gets it twice", () => {
    assert.deepStrictEqual(
      foldersBeyond(folders, [shared]).map(({ name }) => name),
      ["alone"],
    );
  });

  it("knows a folder under another spelling of its path", () => {
    const link = NodePath.join(base, "link");
    NodeFS.symlinkSync(shared, link);
    assert.deepStrictEqual(
      foldersBeyond(folders, [link]).map(({ name }) => name),
      ["alone"],
    );
  });
});

describe("roomReach", () => {
  const root = (project: string) => ({ project, repository: "", task: "", root: `/r/${project}` });

  it("says the room's folders and each run's other projects, each once", () => {
    const stored = {
      runs: { run_1: [root("site"), root("docs"), root("docs")], run_2: [] },
      folders: { g: [{ name: "docs", folder: "/d" }], other: [{ name: "x", folder: "/x" }] },
    };
    assert.deepStrictEqual(roomReach(stored, "g", ["run_1", "run_2", "run_3"]), {
      folders: ["docs"],
      runProjects: { run_1: ["site", "docs"] },
    });
  });

  it("says nothing of a room on one project", () => {
    assert.deepStrictEqual(roomReach(undefined, undefined, ["run_1"]), {
      folders: [],
      runProjects: {},
    });
  });
});
