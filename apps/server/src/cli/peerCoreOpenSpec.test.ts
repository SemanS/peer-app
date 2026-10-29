// @effect-diagnostics nodeBuiltinImport:off - an openspec/ folder in a temporary directory.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import type { PeerTask } from "@t3tools/contracts";

import * as OpenSpec from "./peerCoreOpenSpec.ts";

const task = (id: string, key: string, title: string, area?: string): PeerTask => ({
  id,
  key,
  title,
  ...(area === undefined ? {} : { area }),
  status: "open",
  createdBy: "ana@acme.test",
  createdAt: "2026-10-29T10:00:00Z",
  updatedAt: "2026-10-29T10:00:00Z",
});

const change = (id: string, title: string, capabilities: ReadonlyArray<string> = []) => ({
  id,
  title,
  capabilities,
  done: 0,
  total: 3,
});

describe("OpenSpec import", () => {
  it("reads active changes, their titles, capabilities and progress", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "openspec-"));
    try {
      const write = async (path: string, text: string) => {
        await NodeFSP.mkdir(NodePath.dirname(NodePath.join(root, path)), { recursive: true });
        await NodeFSP.writeFile(NodePath.join(root, path), text);
      };
      assert.isNull(await OpenSpec.readChanges(root));
      await write("openspec/changes/add-draft-surveys/proposal.md", "# Proposal\n\n## Why\n");
      await write(
        "openspec/changes/add-draft-surveys/tasks.md",
        "## 1. API\n- [x] 1.1 Store drafts\n- [ ] 1.2 Restore drafts\n  - [X] nested\n",
      );
      await write("openspec/changes/add-draft-surveys/specs/survey-editor/spec.md", "x");
      await write("openspec/changes/fix-quota/proposal.md", "# Change: Fix the response quota\n");
      await write("openspec/changes/archive/2026-01-01-old/proposal.md", "# Old\n");
      assert.deepStrictEqual(await OpenSpec.readChanges(root), [
        {
          id: "add-draft-surveys",
          title: "Add draft surveys",
          capabilities: ["survey-editor"],
          done: 2,
          total: 3,
        },
        { id: "fix-quota", title: "Fix the response quota", capabilities: [], done: 0, total: 0 },
      ]);
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });

  it("maps a capability to the project area it names, when exactly one does", () => {
    const areas = ["Survey Editor", "Billing"];
    assert.strictEqual(
      OpenSpec.areaOf(change("a", "A", ["survey-editor"]), areas),
      "Survey Editor",
    );
    assert.isNull(OpenSpec.areaOf(change("b", "B", ["survey-editor", "billing"]), areas));
    assert.isNull(OpenSpec.areaOf(change("c", "C", ["analytics"]), areas));
  });

  it("creates what is new, updates only what Peer did not change, and shows conflicts", () => {
    const areas = ["Survey Editor"];
    const record = {
      moved: { task: "t1", title: "Old title", area: null },
      edited: { task: "t2", title: "Imported", area: null },
      both: { task: "t3", title: "Base", area: null },
    };
    const steps = OpenSpec.plan(
      [
        change("fresh", "Fresh change", ["survey-editor"]),
        change("moved", "New title"),
        change("edited", "Imported"),
        change("both", "OpenSpec title"),
        change("adopt", "Adopt me"),
        change("adopt-differs", "Spec words"),
      ],
      [
        task("t1", "moved", "Old title"),
        // Renamed in Peer; OpenSpec did not move: Peer's title stays.
        task("t2", "edited", "Renamed in Peer"),
        task("t3", "both", "Peer title"),
        // Created by hand with the change's key: adopted, never duplicated.
        task("t4", "ADOPT", "Adopt me"),
        task("t5", "adopt-differs", "Hand words"),
      ],
      areas,
      record,
    );
    assert.deepStrictEqual(
      steps.map((step) => [
        step.change.id,
        step.kind,
        step.kind === "update" ? step.title : step.kind === "conflict" ? step.fields : undefined,
      ]),
      [
        ["fresh", "create", undefined],
        ["moved", "update", "New title"],
        ["edited", "same", undefined],
        ["both", "conflict", ["title"]],
        ["adopt", "same", undefined],
        ["adopt-differs", "conflict", ["title"]],
      ],
    );
    assert.deepStrictEqual(steps[0], {
      kind: "create",
      change: change("fresh", "Fresh change", ["survey-editor"]),
      area: "Survey Editor",
    });
    assert.strictEqual(
      OpenSpec.summary(steps),
      "6 OpenSpec changes: 1 new, 1 to update, 2 in conflict, 2 up to date",
    );
  });
});
