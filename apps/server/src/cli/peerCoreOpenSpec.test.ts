// @effect-diagnostics nodeBuiltinImport:off - an openspec/ folder in a temporary directory.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import type { PeerHubCreateTaskInput, PeerHubUpdateTaskInput, PeerTask } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as PeerHubClient from "../peerHub/core/hub/PeerHubClient.ts";
import * as PeerWork from "../peerHub/core/work/PeerWork.ts";

import * as OpenSpec from "./peerCoreOpenSpec.ts";

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

  it("keys a change by its id, or by its first words and a hash when the Hub would refuse it", () => {
    assert.strictEqual(OpenSpec.keyOf("add-draft-surveys"), "add-draft-surveys");
    const long = OpenSpec.keyOf("add-resource-claims-and-path-policies");
    assert.match(long, /^add-resource-claims-and-[0-9a-f]{4}$/);
    assert.isAtMost(long.length, 32);
    assert.strictEqual(OpenSpec.keyOf("add-resource-claims-and-path-policies"), long);
    assert.notStrictEqual(OpenSpec.keyOf("add-resource-claims-and-path-rules"), long);
    assert.match(
      OpenSpec.keyOf("2026_10_drafts.v2"),
      /^2026-10-drafts-v2$|^2026-10-drafts-v2-[0-9a-f]{4}$/,
    );
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
});

/** A Hub that keeps the tree, as far as the import reads and writes it. */
const standInHub = () => {
  const tasks: Array<PeerTask> = [];
  const writes: Array<string> = [];
  const work = {
    createTask: (input: PeerHubCreateTaskInput) =>
      Effect.sync(() => {
        const { workspace: _w, projectId: _p, ...fields } = input;
        const created: PeerTask = {
          ...fields,
          id: `t${tasks.length + 1}`,
          ...(fields.key === undefined ? {} : { key: fields.key.toUpperCase() }),
          executable: fields.executable ?? fields.kind !== "group",
          status: "open",
          createdBy: "ana@acme.test",
          createdAt: "2026-10-29T10:00:00Z",
          updatedAt: "2026-10-29T10:00:00Z",
        };
        tasks.push(created);
        writes.push(`create ${created.title}`);
        return { createdTask: created };
      }),
    updateTask: (input: PeerHubUpdateTaskInput) =>
      Effect.sync(() => {
        const { workspace: _w, projectId: _p, taskId, source, ...fields } = input;
        const at = tasks.findIndex((task) => task.id === taskId);
        const { source: kept, ...rest } = tasks[at]!;
        const next = source === undefined ? kept : (source ?? undefined);
        // The import sends only the fields it changes, so none of them is undefined here.
        tasks[at] = {
          ...rest,
          ...fields,
          ...(next === undefined ? {} : { source: next }),
        } as PeerTask;
        writes.push(`update ${taskId}`);
      }),
  } as unknown as PeerWork.PeerWork["Service"];
  const client = {
    session: Effect.succeed({ hubUrl: "https://hub.test", session: "phs" }),
    me: Effect.succeed({ email: "ana@acme.test", workspaces: [], joinable: [], features: {} }),
    features: Effect.succeed({}),
    api: {
      work: () =>
        Effect.sync(() => ({ projects: { pay: { areas: [], tasks: [...tasks], threads: [] } } })),
    },
  } as unknown as PeerHubClient.PeerHubClient["Service"];
  return { tasks, writes, work, client };
};

describe("OpenSpec import as a tree", () => {
  it.effect("imports a change's items once: a second run plans nothing", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "openspec-")),
      );
      const write = (path: string, text: string) =>
        Effect.promise(async () => {
          await NodeFSP.mkdir(NodePath.dirname(NodePath.join(root, path)), { recursive: true });
          await NodeFSP.writeFile(NodePath.join(root, path), text);
        });
      yield* write("openspec/changes/add-x/proposal.md", "# Add X\n");
      yield* write("openspec/changes/add-x/notes.md", "loose notes\n");
      yield* write(
        "openspec/changes/add-x/tasks.md",
        [
          "## 1. Server",
          "- [x] 1.1 Store",
          "- [ ] 1.2 Routes",
          "  - [ ] 1.2.1 Read",
          "  - [ ] 1.2.2 Write",
          "  - Depends on 1.1",
        ].join("\n"),
      );
      const hub = standInHub();
      const lines: Array<string> = [];
      const io = {
        say: (line: string) => Effect.sync(() => void lines.push(line)),
        askCode: Effect.never,
      };
      const target = { workspace: "acme", project: "pay", root, stateDir: root };
      const run = OpenSpec.sync(target, () => Effect.succeed(true), io).pipe(
        Effect.provideService(PeerWork.PeerWork, hub.work),
        Effect.provideService(PeerHubClient.PeerHubClient, hub.client),
      );
      assert.isTrue(yield* run);
      assert.strictEqual(
        lines[0],
        "6 items: 6 new, 0 to update, 0 in conflict, 0 up to date, 0 gone; 1 unsettled; dependencies: not served by this Hub",
      );
      assert.include(lines, "? Routes: run it as one task, or by its parts? Decide in Peer.");
      assert.deepStrictEqual(lines.slice(-2), [
        "Not interpreted:",
        "  openspec/changes/add-x/notes.md",
      ]);
      assert.deepStrictEqual(
        hub.tasks.map((task) => [task.title, task.parent ?? null, task.status]),
        [
          ["Add X", null, "open"],
          ["Server", "t1", "open"],
          ["Store", "t2", "done"],
          ["Routes", "t2", "open"],
          ["Read", "t4", "open"],
          ["Write", "t4", "open"],
        ],
      );
      const writes = hub.writes.length;
      lines.length = 0;
      assert.isTrue(yield* run);
      assert.strictEqual(
        lines[0],
        "6 items: 0 new, 0 to update, 0 in conflict, 6 up to date, 0 gone; 1 unsettled; dependencies: not served by this Hub",
      );
      assert.strictEqual(hub.writes.length, writes);
      yield* Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true }));
    }),
  );
});
