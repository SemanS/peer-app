// @effect-diagnostics nodeBuiltinImport:off - an openspec/ folder in a temporary directory.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

import { foldSteps } from "../peerHub/core/work/workItems.ts";
import { readChange } from "./openspecItems.ts";

const TASKS = `# Tasks

## 1. Server

- [x] 1.1 Store the tree
- [ ] 1.2 Routes (depends on 1.1)
  - [ ] 1.2.1 Read
  - [ ] 1.2.2 Write
    - keep the handler thin
  - Depends on 1.1, 9.9
- [ ] Unnumbered item
  - a step of it

## 2. Clients

### Web

- [ ] 2.1 Rows
`;

const withChange = async (
  files: Readonly<Record<string, string>>,
  run: (root: string) => Promise<void>,
) => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "openspec-items-"));
  try {
    for (const [path, text] of Object.entries(files)) {
      await NodeFSP.mkdir(NodePath.dirname(NodePath.join(root, path)), { recursive: true });
      await NodeFSP.writeFile(NodePath.join(root, path), text);
    }
    await run(root);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
};

describe("readChange", () => {
  it("reads headings, nested checkboxes, steps and dependencies as items", () =>
    withChange(
      {
        "openspec/changes/add-x/proposal.md": "# Change: Add the tree\n",
        "openspec/changes/add-x/design.md": "x",
        "openspec/changes/add-x/tasks.md": TASKS,
        "openspec/changes/add-x/specs/work-items/spec.md": "x",
        "openspec/changes/add-x/notes.md": "x",
        "openspec/changes/add-x/.openspec.yaml": "x",
        "openspec/config.yaml": "schema: my-schema\n",
      },
      async (root) => {
        const { items, notInterpreted } = await readChange(root, "add-x", [
          "Work Items",
          "Billing",
        ]);
        const [change, ...rest] = foldSteps(items);
        assert.deepStrictEqual(change, {
          ref: "add-x",
          parent: null,
          kind: "group",
          title: "Add the tree",
          executable: false,
          unsettled: false,
          position: 0,
          done: false,
          dependencies: [],
          key: "add-x",
          area: "Work Items",
          description:
            "Context: openspec/changes/add-x/proposal.md, openspec/changes/add-x/design.md, openspec/changes/add-x/specs/work-items/spec.md",
        });
        const byTitle = new Map(rest.map((item) => [item.title, item]));
        const server = byTitle.get("Server")!;
        assert.match(server.ref, /^add-x#h:[0-9a-f]{8}$/);
        assert.strictEqual(server.parent, "add-x");
        assert.deepStrictEqual(
          rest.map((item) => [
            item.title,
            item.kind,
            item.executable,
            item.unsettled,
            item.done,
            item.position,
          ]),
          [
            ["Server", "group", false, false, false, 0],
            ["Store the tree", "task", true, false, true, 0],
            ["Routes", "task", false, true, false, 1],
            ["Read", "task", true, false, false, 0],
            ["Write", "task", true, false, false, 1],
            ["Unnumbered item", "task", true, false, false, 2],
            ["Clients", "group", false, false, false, 1],
            ["Web", "group", false, false, false, 0],
            ["Rows", "task", true, false, false, 0],
          ],
        );
        const routes = byTitle.get("Routes")!;
        assert.strictEqual(routes.ref, "add-x#1.2");
        assert.strictEqual(routes.parent, server.ref);
        assert.deepStrictEqual(routes.dependencies, ["add-x#1.1"]);
        assert.strictEqual(byTitle.get("Read")!.parent, "add-x#1.2");
        assert.strictEqual(byTitle.get("Write")!.description, "- keep the handler thin");
        const unnumbered = byTitle.get("Unnumbered item")!;
        assert.match(unnumbered.ref, /^add-x#[0-9a-f]{8}$/);
        assert.strictEqual(unnumbered.description, "- a step of it");
        assert.strictEqual(byTitle.get("Web")!.parent, byTitle.get("Clients")!.ref);
        assert.deepStrictEqual(notInterpreted, [
          "openspec/changes/add-x/notes.md",
          "openspec/changes/add-x/tasks.md: depends on 9.9, which names no item",
          "schema my-schema: Peer reads tasks.md checklists only",
        ]);
        // The same file reads to the same refs on every computer.
        const again = await readChange(root, "add-x");
        assert.deepStrictEqual(
          again.items.map((item) => item.ref),
          items.map((item) => item.ref),
        );
      },
    ));

  it("reads a change without checkboxes as one task, as before the tree", () =>
    withChange({ "openspec/changes/fix-quota/proposal.md": "# Fix the quota\n" }, async (root) => {
      const { items, notInterpreted } = await readChange(root, "fix-quota");
      assert.deepStrictEqual(
        items.map((item) => [item.ref, item.kind, item.executable]),
        [["fix-quota", "task", true]],
      );
      assert.deepStrictEqual(notInterpreted, [
        "openspec/changes/fix-quota/: no tasks.md, imported as one task",
      ]);
    }));

  it("keeps the Hub's title length and opens the description with the whole text", () =>
    withChange(
      { "openspec/changes/add-y/tasks.md": `- [ ] 1 ${"word ".repeat(40)}\n` },
      async (root) => {
        const [, long] = (await readChange(root, "add-y")).items;
        assert.isAtMost([...long!.title].length, 120);
        assert.isTrue(long!.description!.startsWith(long!.title));
        assert.isAbove(long!.description!.length, 120);
      },
    ));
});
