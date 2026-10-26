import { describe, expect, it } from "@effect/vitest";

import type { CliError } from "./cliContract.ts";
import type { PeerBrokerHost } from "./host.ts";
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
});
