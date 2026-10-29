import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { CliError } from "./cliContract.ts";
import { NO_PLUGINS, type PeerBrokerHost } from "./host.ts";
import { sessionTaskName, treeOrder } from "./tasks.ts";
import { brokerFixture } from "./testkit.ts";

type Task = ReturnType<PeerBrokerHost["tasks"]>[number];

/** A broker whose host keeps the project's tasks as the Hub would, after each write. */
async function withTasks(initial: ReadonlyArray<Task>, refuse = false) {
  let tasks = [...initial];
  let next = initial.length + 1;
  const writes: Array<unknown> = [];
  const fixture = await brokerFixture(() => ({
    tasks: () => tasks,
    createTask: async (workspace, project, task) => {
      writes.push({ create: { workspace, project, ...task } });
      if (refuse)
        throw Object.assign(new Error("Only the project's members add tasks."), { refused: true });
      tasks = [...tasks, { id: `t${next++}`, status: "open", ...task }];
    },
    updateTask: async (_workspace, _project, id, change) => {
      writes.push({ update: { id, ...change } });
      tasks = tasks.map((task) =>
        task.id === id
          ? { ...task, ...change, ...(change.area === "" ? { area: undefined } : {}) }
          : task,
      );
    },
    deleteTask: async (_workspace, _project, id) => {
      writes.push({ delete: id });
      tasks = tasks.filter((task) => task.id !== id);
    },
  }));
  await fixture.register("one");
  const run = (args: ReadonlyArray<string>) =>
    fixture.broker.runCli("task", args, { "x-peer-session": "claude:one" });
  const fails = (args: ReadonlyArray<string>) =>
    run(args).then(
      () => {
        throw new Error(`peer task ${args.join(" ")} succeeded`);
      },
      (error: CliError) => error,
    );
  return { fixture, run, fails, writes, tasks: () => tasks };
}

const diarization = { id: "t1", key: "STR-9", title: "Diarization memory bounds", status: "open" };

describe("peer task", () => {
  it("lists the project's tasks, then adds, changes and removes one for the person", async () => {
    const { fixture, run, writes, tasks } = await withTasks([diarization]);
    try {
      expect(await run([])).toBe(
        "Tasks of app (1):\n  STR-9 · Diarization memory bounds [open] id:t1",
      );
      expect(await run(["add", "Speaker", "naming", "--key", "STR-10", "--area", "speech"])).toBe(
        "Added STR-10 · Speaker naming [open] (speech) id:t2.",
      );
      expect(await run(["set", "str-10", "--status", "review", "--area", ""])).toBe(
        "Changed STR-10 · Speaker naming [review] id:t2.\nThis administrative status change did not verify the agent's handoff. Use peer review or peer done for guarded handoff checks.",
      );
      expect(await run(["set", "Diarization memory bounds", "--title", "Bounded AHC"])).toContain(
        "STR-9 · Bounded AHC [open]",
      );
      expect(await run(["remove", "t2"])).toContain("Removed STR-10 · Speaker naming");
      expect(tasks().map((task) => task.id)).toEqual(["t1"]);
      expect(writes).toEqual([
        {
          create: {
            workspace: "acme",
            project: "app",
            title: "Speaker naming",
            key: "STR-10",
            area: "speech",
          },
        },
        { update: { id: "t2", area: "", status: "review" } },
        { update: { id: "t1", title: "Bounded AHC" } },
        { delete: "t2" },
      ]);
    } finally {
      await fixture.dispose();
    }
  });

  it("keeps administrative completion and reopening available without implying a verified handoff", async () => {
    const { fixture, run, writes } = await withTasks([diarization]);
    try {
      expect(await run(["set", "t1", "--status", "done"])).toContain(
        "did not verify the agent's handoff",
      );
      expect(await run(["set", "t1", "--status", "open"])).toBe(
        "Changed STR-9 · Diarization memory bounds [open] id:t1.",
      );
      expect(writes).toEqual([
        { update: { id: "t1", status: "done" } },
        { update: { id: "t1", status: "open" } },
      ]);
    } finally {
      await fixture.dispose();
    }
  });

  it("refuses what it cannot tell or do, and passes on the Hub's refusal", async () => {
    const { fixture, fails, writes } = await withTasks(
      [
        diarization,
        { id: "t2", title: "Twin", status: "open" },
        { id: "t3", title: "Twin", status: "open" },
      ],
      true,
    );
    try {
      for (const args of [
        ["drop"],
        ["add"],
        ["add", "x", "--status", "done"],
        ["set", "STR-9"],
        ["set", "STR-9", "--status", "closed"],
        ["set", "STR-9", "--key", "STR-1"],
        ["list", "--all"],
        ["remove"],
      ])
        expect((await fails(args)).outcome, args.join(" ")).toBe("usage");
      expect((await fails(["remove", "STR-404"])).reason).toContain("has no task STR-404");
      expect((await fails(["set", "Twin", "--status", "done"])).reason).toContain(
        "2 tasks are titled Twin",
      );
      const refused = await fails(["add", "New"]);
      expect(refused.outcome).toBe("refused");
      expect(refused.reason).toContain("Only the project's members add tasks.");
      expect(writes).toHaveLength(1);
    } finally {
      await fixture.dispose();
    }
  });

  it("adds what active plugins say of a task to its line, for peer task list and peer_task list", async () => {
    const asked: Array<unknown> = [];
    const fixture = await brokerFixture(() => ({
      tasks: () => [diarization, { id: "t2", title: "Speaker naming", status: "done" }],
      plugins: async () => ({
        ...NO_PLUGINS,
        active: [
          {
            id: "acceptance",
            title: "Acceptance",
            contributions: {
              taskFacts: (place, tasks) =>
                Effect.sync(() => {
                  asked.push({ place, tasks: tasks.map((task) => task.id) });
                  return new Map([
                    ["t2", "accepted by Ana"],
                    ["t9", "a task the list does not have"],
                  ]);
                }),
            },
          },
          { id: "observe", title: "Observe", contributions: {} },
          {
            id: "roles",
            title: "Roles",
            contributions: { taskFacts: () => Effect.succeed(new Map([["t2", " "]])) },
          },
        ],
      }),
    }));
    try {
      await fixture.register("one");
      const headers = { "x-peer-session": "claude:one" };
      const listed = [
        "Tasks of app (2):",
        "  STR-9 · Diarization memory bounds [open] id:t1",
        "  Speaker naming [done] id:t2 · accepted by Ana",
      ].join("\n");
      expect(await fixture.broker.runCli("task", [], headers)).toBe(listed);
      // The peer_task tool's list runs `peer task list`.
      expect(await fixture.broker.runCli("task", ["list"], headers)).toBe(listed);
      expect(asked[0]).toEqual({
        place: { workspace: "acme", project: "app" },
        tasks: ["t1", "t2"],
      });
    } finally {
      await fixture.dispose();
    }
  });

  describe("the tree", () => {
    const tree: ReadonlyArray<Task> = [
      { id: "t7", title: "Loose", status: "open" },
      { id: "t3", title: "Write the API", status: "done", parent: "t2", position: 1 },
      {
        id: "t1",
        key: "ADD-X",
        title: "Add X",
        status: "open",
        kind: "group",
        executable: false,
        progress: { done: 1, total: 3 },
      },
      {
        id: "t2",
        title: "Hub",
        status: "open",
        parent: "t1",
        executable: false,
        unsettled: true,
        progress: { done: 1, total: 2 },
      },
      { id: "t4", title: "Store the rows", status: "open", parent: "t2", position: 0 },
      { id: "t5", title: "Docs", status: "review", parent: "t1", position: 2 },
      { id: "t6", title: "Orphan", status: "open", parent: "gone" },
    ];

    it("prints parents before children, siblings by position, progress, ? and group", async () => {
      const { fixture, run } = await withTasks(tree);
      try {
        expect(await run(["list"])).toBe(
          [
            "Tasks of app (7):",
            "  Loose [open] id:t7",
            "  ADD-X · Add X 1/3 [open] group id:t1",
            "    ? Hub 1/2 [open] id:t2",
            "      Store the rows [open] id:t4",
            "      Write the API [done] id:t3",
            "    Docs [review] id:t5",
            "  Orphan [open] id:t6",
          ].join("\n"),
        );
        expect(await run(["list", "--flat"])).toBe(
          [
            "Tasks of app (7):",
            "  Loose [open] id:t7",
            "  Write the API [done] id:t3",
            "  ADD-X · Add X [open] id:t1",
            "  Hub [open] id:t2",
            "  Store the rows [open] id:t4",
            "  Docs [review] id:t5",
            "  Orphan [open] id:t6",
          ].join("\n"),
        );
      } finally {
        await fixture.dispose();
      }
    });

    it("keeps a cycle the Hub should never hold listed", () => {
      const looped: ReadonlyArray<Task> = [
        { id: "a", title: "A", parent: "b" },
        { id: "b", title: "B", parent: "a" },
      ];
      expect(treeOrder(looped).map(({ task }) => task.id)).toEqual(["a", "b"]);
    });

    it("adds under a parent, as a group or not executable, and refuses an unknown parent", async () => {
      const { fixture, run, fails, writes } = await withTasks(tree);
      try {
        expect(await run(["add", "Second", "store", "--under", "add-x", "--not-executable"])).toBe(
          "Added Second store [open] id:t8 under ADD-X · Add X [open] id:t1.",
        );
        expect(await run(["add", "--kind", "group", "Phase 2"])).toBe(
          "Added Phase 2 [open] group id:t9.",
        );
        const unknown = await fails(["add", "x", "--under", "NOPE-1"]);
        expect(unknown.outcome).toBe("refused");
        expect(unknown.reason).toContain("this project has no task NOPE-1");
        expect((await fails(["add", "x", "--kind", "epic"])).outcome).toBe("usage");
        expect((await fails(["add", "x", "--under", "none"])).outcome).toBe("refused");
        expect((await fails(["add", "x", "--executable", "no"])).outcome).toBe("usage");
        expect(writes).toEqual([
          {
            create: {
              workspace: "acme",
              project: "app",
              title: "Second store",
              parent: "t1",
              executable: false,
            },
          },
          { create: { workspace: "acme", project: "app", title: "Phase 2", kind: "group" } },
        ]);
      } finally {
        await fixture.dispose();
      }
    });

    it("moves, settles and orders an item, and refuses what the tree cannot hold", async () => {
      const { fixture, run, fails, writes } = await withTasks(tree);
      try {
        expect(await run(["set", "t2", "--executable", "yes"])).toBe(
          "Changed Hub [open] id:t2.\nThis settles it: an agent may run it as one task.",
        );
        expect(await run(["set", "t2", "--executable", "no"])).toContain(
          "This settles it: it is not run as one task; its items are.",
        );
        expect(await run(["set", "t5", "--under", "none", "--position", "3"])).toBe(
          "Changed Docs [review] id:t5.",
        );
        expect(await run(["set", "Loose", "--under", "ADD-X"])).toBe("Changed Loose [open] id:t7.");
        for (const args of [
          ["set", "t2", "--executable", "maybe"],
          ["set", "t2", "--position", "-1"],
          ["set", "t2", "--position", "1.5"],
          ["set", "t2", "--position", "2000000"],
          ["set", "t2", "--kind", "group"],
          ["set", "t2", "--flat"],
          ["list", "--not-executable"],
          ["remove", "t2", "--flat"],
        ])
          expect((await fails(args)).outcome, args.join(" ")).toBe("usage");
        const cycle = await fails(["set", "ADD-X", "--under", "t4"]);
        expect(cycle.outcome).toBe("refused");
        expect(cycle.reason).toContain("cannot sit under itself or one of its own items");
        expect((await fails(["set", "t2", "--under", "t2"])).outcome).toBe("refused");
        expect((await fails(["set", "t2", "--under", "STR-404"])).reason).toContain(
          "has no task STR-404",
        );
        expect(writes).toEqual([
          { update: { id: "t2", executable: true } },
          { update: { id: "t2", executable: false } },
          { update: { id: "t5", parent: "", position: 3 } },
          { update: { id: "t7", parent: "t1" } },
        ]);
      } finally {
        await fixture.dispose();
      }
    });

    it("names a session's group by its progress and open items in peer status", () => {
      const group = tree.find((task) => task.id === "t1")!;
      expect(sessionTaskName(tree, group, "ADD-X · Add X")).toBe(
        "ADD-X · Add X (group: 1/3 done, 1 open item)",
      );
      expect(
        sessionTaskName(
          tree,
          tree.find((task) => task.id === "t2")!,
          "Hub",
        ),
      ).toBe("Hub (items: 1/2 done, 1 open item)");
      expect(
        sessionTaskName(
          tree,
          tree.find((task) => task.id === "t4")!,
          "Store",
        ),
      ).toBe("Store");
    });
  });
});
