import { assert, describe, it } from "@effect/vitest";
import type { PeerHubCreateTaskInput, PeerHubUpdateTaskInput, PeerTask } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as PeerHubClient from "../hub/PeerHubClient.ts";
import * as PeerWork from "./PeerWork.ts";
import {
  applySync,
  foldSteps,
  planSync,
  syncRecordOf,
  syncSummary,
  type SyncOptions,
  type SyncRecord,
  type SyncStep,
  type WorkItem,
} from "./workItems.ts";

const OPTIONS: SyncOptions = { system: "openspec", tree: true, dependencies: true };

const item = (ref: string, parent: string | null, fields: Partial<WorkItem> = {}): WorkItem => ({
  ref,
  parent,
  kind: "task",
  title: ref,
  executable: true,
  unsettled: false,
  position: 0,
  done: false,
  dependencies: [],
  ...fields,
});

const task = (id: string, fields: Partial<PeerTask> = {}): PeerTask => ({
  id,
  title: id,
  status: "open",
  createdBy: "ana@acme.test",
  createdAt: "2026-10-29T10:00:00Z",
  updatedAt: "2026-10-29T10:00:00Z",
  executable: true,
  ...fields,
});

const shape = (steps: ReadonlyArray<SyncStep>) =>
  steps.map((step) =>
    step.kind === "create"
      ? ["create", step.item.ref]
      : step.kind === "gone"
        ? ["gone", step.ref, step.task.id]
        : [
            step.kind,
            step.item.ref,
            step.task.id,
            step.kind === "conflict" ? step.fields : step.change,
          ],
  );

const change = item("add-x", null, {
  kind: "group",
  executable: false,
  title: "Add X",
  key: "add-x",
});

describe("foldSteps", () => {
  it("makes steps lines of their nearest item's description", () => {
    const folded = foldSteps([
      change,
      item("add-x#1", "add-x", { description: "Context" }),
      item("s1", "add-x#1", { kind: "step", title: "Write the route" }),
      item("s2", "s1", { kind: "step", title: "Nested step" }),
    ]);
    assert.deepStrictEqual(
      folded.map((entry) => [entry.ref, entry.description]),
      [
        ["add-x", undefined],
        ["add-x#1", "Context\n\n- Write the route\n- Nested step"],
      ],
    );
  });
});

describe("planSync", () => {
  it("creates a new tree parents first and plans nothing once it is recorded", () => {
    const items = [change, item("add-x#1", "add-x"), item("add-x#1.1", "add-x#1", { position: 0 })];
    assert.deepStrictEqual(shape(planSync(items, [], {}, OPTIONS)), [
      ["create", "add-x"],
      ["create", "add-x#1"],
      ["create", "add-x#1.1"],
    ]);
    const tasks = [
      task("t0", { title: "Add X", kind: "group", executable: false, key: "ADD-X" }),
      task("t1", { title: "add-x#1", parent: "t0" }),
      task("t2", { title: "add-x#1.1", parent: "t1" }),
    ];
    const recorded = (id: string, title: string, parent: string | null, fields = {}) => ({
      task: id,
      title,
      parent,
      position: 0,
      kind: "task" as const,
      executable: true,
      unsettled: false,
      status: "open" as const,
      description: "",
      dependencies: [],
      ...fields,
    });
    const record: SyncRecord = {
      "add-x": recorded("t0", "Add X", null, { area: null, kind: "group", executable: false }),
      "add-x#1": recorded("t1", "add-x#1", "t0"),
      "add-x#1.1": recorded("t2", "add-x#1.1", "t1"),
    };
    // The tasks carry no source: the first run writes it, the next has nothing left to do.
    const first = planSync(items, tasks, record, OPTIONS);
    assert.deepStrictEqual(
      first.map((step) => step.kind),
      ["update", "update", "update"],
    );
    const sourced = tasks.map((entry, index) => ({
      ...entry,
      source: { system: "openspec", ref: items[index]!.ref },
    }));
    assert.deepStrictEqual(
      planSync(items, sourced, record, OPTIONS).map((step) => step.kind),
      ["same", "same", "same"],
    );
  });

  it("finds an item by its source, its key, its title under the parent, then its place", () => {
    const items = [
      change,
      item("add-x#1", "add-x", { title: "Server" }),
      item("add-x#2", "add-x", { title: "Docs", position: 1 }),
      item("add-x#3", "add-x", { title: "Renamed in the file", position: 2 }),
    ];
    const tasks = [
      task("root", { key: "ADD-X", title: "Add X", kind: "group", executable: false }),
      task("by-source", {
        parent: "root",
        title: "Other words",
        source: { system: "openspec", ref: "add-x#1" },
      }),
      task("by-title", { parent: "root", title: "  docs " }),
      task("by-place", { parent: "root", title: "Old words", position: 2 }),
    ];
    const steps = planSync(items, tasks, {}, OPTIONS);
    assert.deepStrictEqual(
      steps.map((step) =>
        step.kind === "create" || step.kind === "gone" ? step.kind : step.task.id,
      ),
      ["root", "by-source", "by-title", "by-place"],
    );
    // Without a record of its own, a title that differs was a person's: never written over.
    assert.deepStrictEqual(
      steps.map((step) => step.kind),
      ["update", "conflict", "conflict", "conflict"],
    );
  });

  it("writes what moved in the source, keeps Peer's edits and says a conflict", () => {
    const record: SyncRecord = {
      "add-x#1": {
        task: "t1",
        title: "Old",
        parent: "t0",
        position: 0,
        kind: "task",
        executable: true,
        unsettled: false,
        status: "open",
        description: "",
      },
      "add-x#2": {
        task: "t2",
        title: "Base",
        parent: "t0",
        position: 1,
        kind: "task",
        executable: true,
        unsettled: false,
        status: "open",
        description: "",
      },
      "add-x#3": {
        task: "t3",
        title: "Same",
        parent: "t0",
        position: 2,
        kind: "task",
        executable: true,
        unsettled: false,
        status: "review",
        description: "",
      },
    };
    const tasks = [
      task("t0", { title: "Add X", kind: "group", executable: false, key: "ADD-X" }),
      task("t1", { title: "Old", parent: "t0", source: { system: "openspec", ref: "add-x#1" } }),
      task("t2", {
        title: "Peer words",
        parent: "t0",
        position: 1,
        source: { system: "openspec", ref: "add-x#2" },
      }),
      task("t3", {
        title: "Same",
        parent: "t0",
        position: 2,
        status: "review",
        source: { system: "openspec", ref: "add-x#3" },
      }),
    ];
    const items = [
      change,
      item("add-x#1", "add-x", { title: "New", done: true }),
      item("add-x#2", "add-x", { title: "File words", position: 1 }),
      item("add-x#3", "add-x", { title: "Same", position: 2, done: true }),
    ];
    const steps = planSync(
      items,
      tasks,
      { ...record, "add-x": { task: "t0", title: "Add X" } },
      OPTIONS,
    );
    assert.deepStrictEqual(shape(steps).slice(1), [
      ["update", "add-x#1", "t1", { title: "New", status: "done" }],
      ["conflict", "add-x#2", "t2", ["title"]],
      // A review waits for a person: the import never moves a task off it.
      ["same", "add-x#3", "t3", {}],
    ]);
  });

  it("never overrides how a person settled an unsettled item", () => {
    const items = [
      change,
      item("add-x#2", "add-x", { executable: false, unsettled: true }),
      item("add-x#2.1", "add-x#2"),
    ];
    const tasks = [
      task("t0", {
        title: "Add X",
        kind: "group",
        executable: false,
        source: { system: "openspec", ref: "add-x" },
      }),
      task("t2", {
        title: "add-x#2",
        parent: "t0",
        executable: true,
        unsettled: false,
        source: { system: "openspec", ref: "add-x#2" },
      }),
      task("t21", {
        title: "add-x#2.1",
        parent: "t2",
        source: { system: "openspec", ref: "add-x#2.1" },
      }),
    ];
    const base = { position: 0, kind: "task" as const, status: "open" as const, description: "" };
    const record: SyncRecord = {
      "add-x": {
        task: "t0",
        title: "Add X",
        area: null,
        parent: null,
        ...base,
        kind: "group",
        executable: false,
        unsettled: false,
      },
      "add-x#2": {
        task: "t2",
        title: "add-x#2",
        parent: "t0",
        ...base,
        executable: false,
        unsettled: true,
      },
      "add-x#2.1": {
        task: "t21",
        title: "add-x#2.1",
        parent: "t2",
        ...base,
        executable: true,
        unsettled: false,
      },
    };
    const steps = planSync(items, tasks, record, OPTIONS);
    assert.deepStrictEqual(
      steps.map((step) => step.kind),
      ["same", "same", "same"],
    );
    assert.strictEqual(
      syncSummary(steps, true),
      "3 items: 0 new, 0 to update, 0 in conflict, 3 up to date, 0 gone; 0 unsettled; dependencies: recorded",
    );
  });

  it("says an item that left the source is gone and never deletes it", () => {
    const tasks = [
      task("t0", { title: "Add X", kind: "group", executable: false }),
      task("t9", { parent: "t0" }),
    ];
    const steps = planSync(
      [change],
      tasks,
      { "add-x": { task: "t0", title: "Add X" }, "add-x#9": { task: "t9", title: "t9" } },
      OPTIONS,
    );
    assert.deepStrictEqual(shape(steps).at(-1), ["gone", "add-x#9", "t9"]);
    assert.match(
      syncSummary(steps, false),
      /1 gone; 0 unsettled; dependencies: not served by this Hub$/,
    );
  });

  it("reads the record of the import before the tree and turns its change into a group", () => {
    const old = syncRecordOf({
      "add-x": { task: "t0", title: "Add X", area: null },
      broken: { title: "x" },
    });
    assert.deepStrictEqual(Object.keys(old), ["add-x"]);
    const tasks = [task("t0", { title: "Add X", key: "ADD-X", status: "done" })];
    const steps = planSync([change, item("add-x#1", "add-x")], tasks, old, OPTIONS);
    assert.deepStrictEqual(shape(steps), [
      [
        "update",
        "add-x",
        "t0",
        { kind: "group", executable: false, source: { system: "openspec", ref: "add-x" } },
      ],
      ["create", "add-x#1"],
    ]);
  });

  it("gives an older Hub the changes alone, as tasks", () => {
    const items = [change, item("add-x#1", "add-x")];
    const steps = planSync(
      items,
      [task("other", { executable: undefined })],
      {},
      { ...OPTIONS, tree: false },
    );
    assert.deepStrictEqual(shape(steps), [["create", "add-x"]]);
  });
});

describe("applySync", () => {
  it.effect(
    "creates parents before children, records after every write and adds dependencies",
    () =>
      Effect.gen(function* () {
        const created: Array<PeerHubCreateTaskInput> = [];
        const updated: Array<PeerHubUpdateTaskInput> = [];
        const edges: Array<[string, ReadonlyArray<string>]> = [];
        const saves: Array<SyncRecord> = [];
        const lines: Array<string> = [];
        const work = {
          createTask: (input: PeerHubCreateTaskInput) =>
            Effect.sync(() => {
              created.push(input);
              return {
                createdTask: task(`t${created.length}`, {
                  title: input.title,
                  ...(input.parent === undefined ? {} : { parent: input.parent }),
                }),
              };
            }),
          updateTask: (input: PeerHubUpdateTaskInput) =>
            Effect.sync(() => void updated.push(input)),
        } as unknown as PeerWork.PeerWork["Service"];
        const client = {
          session: Effect.succeed({ hubUrl: "https://hub.test", session: "phs" }),
          api: {
            dependencies: (
              _h: string,
              _s: string,
              _w: string,
              _p: string,
              id: string,
              body: { add: ReadonlyArray<string> },
            ) =>
              Effect.sync(() => {
                edges.push([id, body.add]);
                return { task: id, dependsOn: body.add, changed: true };
              }),
          },
        } as unknown as PeerHubClient.PeerHubClient["Service"];
        const items = [
          change,
          item("add-x#1", "add-x", { executable: false, unsettled: true }),
          item("add-x#1.1", "add-x#1", { done: true }),
          item("add-x#2", "add-x", { position: 1, dependencies: ["add-x#1.1"] }),
        ];
        const steps = planSync(items, [], {}, OPTIONS);
        const result = yield* applySync({
          target: { workspace: "acme", project: "pay" },
          steps,
          record: {},
          options: OPTIONS,
          save: (record) => Effect.sync(() => void saves.push(record)),
          say: (line) => Effect.sync(() => void lines.push(line)),
        }).pipe(
          Effect.provideService(PeerWork.PeerWork, work),
          Effect.provideService(PeerHubClient.PeerHubClient, client),
        );
        assert.deepStrictEqual(
          created.map((input) => [input.title, input.parent ?? null, input.source?.ref]),
          [
            ["Add X", null, "add-x"],
            ["add-x#1", "t1", "add-x#1"],
            ["add-x#1.1", "t2", "add-x#1.1"],
            ["add-x#2", "t1", "add-x#2"],
          ],
        );
        assert.deepStrictEqual(
          updated.map((input) => [input.taskId, input.status]),
          [["t3", "done"]],
        );
        assert.deepStrictEqual(edges, [["t4", ["t3"]]]);
        assert.deepStrictEqual(result.record["add-x#2"]?.dependencies, ["add-x#1.1"]);
        assert.strictEqual(result.record["add-x#1.1"]?.status, "done");
        assert.isAtLeast(saves.length, 4);
        assert.deepStrictEqual(lines, [
          "+ Add X · add-x",
          "+ add-x#1 · add-x#1",
          "? add-x#1: run it as one task, or by its parts? Decide in Peer.",
          "+ add-x#1.1 · add-x#1.1",
          "+ add-x#2 · add-x#2",
        ]);
        // What the Hub then holds is what the import wrote: the next run plans nothing.
        const tasks = created.map((input, index) =>
          task(`t${index + 1}`, {
            title: input.title,
            ...(input.parent === undefined ? {} : { parent: input.parent }),
            kind: input.kind ?? "task",
            executable: input.executable ?? true,
            unsettled: input.unsettled ?? false,
            position: input.position ?? 0,
            ...(input.key === undefined ? {} : { key: input.key.toUpperCase() }),
            ...(input.source === undefined ? {} : { source: input.source }),
            status: index === 2 ? "done" : "open",
          }),
        );
        assert.deepStrictEqual(
          planSync(items, tasks, result.record, OPTIONS).map((step) => step.kind),
          ["same", "same", "same", "same"],
        );
      }),
  );
});
