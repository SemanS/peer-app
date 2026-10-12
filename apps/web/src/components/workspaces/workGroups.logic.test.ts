import { EnvironmentId, ThreadId, type PeerHubStatus, type PeerTask } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { groupTasks, taskHasOverlap, taskOverlap } from "./workGroups.logic";
import type { WorkAreaNode, WorkProjectNode, WorkTaskNode, WorkThreadNode } from "./workTree.logic";

function thread(key: string, overrides: Partial<WorkThreadNode> = {}): WorkThreadNode {
  return {
    key,
    title: key,
    person: "You",
    mine: true,
    status: "idle",
    delivery: "open",
    harness: undefined,
    branch: undefined,
    source: "peer",
    stale: false,
    open: {
      kind: "thread",
      environmentId: EnvironmentId.make("env"),
      threadId: ThreadId.make(key),
    },
    placeable: true,
    concerns: undefined,
    observable: false,
    agent: undefined,
    activeAt: undefined,
    keepsContext: false,
    ...overrides,
  };
}

function task(id: string, overrides: Partial<Omit<WorkTaskNode, "id">> = {}): WorkTaskNode {
  return {
    id,
    key: id.toUpperCase(),
    title: `Task ${id}`,
    done: false,
    status: "idle",
    threads: [],
    removable: true,
    context: undefined,
    ...overrides,
  };
}

function hubTask(
  id: string,
  status: PeerTask["status"],
  overrides: Partial<PeerTask> = {},
): PeerTask {
  return {
    id,
    title: id,
    status,
    createdBy: "ana@acme.dev",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function project(
  areas: ReadonlyArray<WorkAreaNode>,
  tasks: ReadonlyArray<PeerTask> = [],
): WorkProjectNode {
  return {
    workspace: "acme",
    workspaceName: "Acme",
    projectId: "app",
    name: "app",
    areas,
    unsorted: [],
    context: undefined,
    candidates: 0,
    tasks,
  };
}

describe("groupTasks", () => {
  it("lists open tasks by area in the project's order and folds done ones into one group", () => {
    const groups = groupTasks(
      project(
        [
          { name: "Orders", tasks: [task("a"), task("b", { status: "working" }), task("c")] },
          { name: "Receipts", tasks: [task("d"), task("e", { done: true })] },
          { name: null, tasks: [task("f", { status: "done" })] },
        ],
        [hubTask("a", "review"), hubTask("c", "done"), hubTask("d", "open")],
      ),
    );
    expect(groups.map((group) => [group.title, group.tasks.map((t) => t.id)])).toEqual([
      ["Orders", ["a", "b"]],
      ["Receipts", ["d"]],
      ["Done", ["c", "e", "f"]],
    ]);
    expect(groups.map((group) => group.done)).toEqual([false, false, true]);
  });

  it("names tasks in no area 'No area' beside named areas, and shows no heading when none is named", () => {
    const mixed = groupTasks(
      project([
        { name: "Orders", tasks: [task("a")] },
        { name: null, tasks: [task("b")] },
      ]),
    );
    expect(mixed.map((group) => group.title)).toEqual(["Orders", "No area"]);
    const unnamed = groupTasks(project([{ name: null, tasks: [task("a")] }]));
    expect(unnamed.map((group) => group.title)).toEqual([undefined]);
  });

  it("orders an area by what needs you, then work in progress, then paused, then not started", () => {
    const orders = (tasks: ReadonlyArray<WorkTaskNode>) =>
      groupTasks(project([{ name: "Orders", tasks }]))[0]?.tasks.map((t) => t.id);
    expect(
      orders([
        task("fresh"),
        task("paused", { threads: [thread("p")] }),
        task("working", { threads: [thread("w", { status: "working" })] }),
        task("asks", { threads: [thread("q", { status: "blocked" })] }),
        task("review", { inReview: true, threads: [thread("r", { status: "working" })] }),
        task("ana", { threads: [thread("n", { mine: false, person: "Ana", status: "blocked" })] }),
      ]),
    ).toEqual(["asks", "review", "working", "ana", "paused", "fresh"]);
  });

  it("puts the latest activity first among tasks in the same state", () => {
    const quiet = task("quiet", { threads: [thread("a", { activeAt: "2026-10-12T08:00:00Z" })] });
    const recent = task("recent", { threads: [thread("b", { activeAt: "2026-10-12T11:00:00Z" })] });
    const touched = task("touched");
    const same = task("same");
    const groups = groupTasks(
      project(
        [{ name: "Orders", tasks: [quiet, same, touched, recent] }],
        [hubTask("touched", "open", { updatedAt: "2026-10-12T09:30:00Z" })],
      ),
    );
    // Chats are paused, so they come before the tasks not started; `same` has no time at all and
    // keeps its place behind `touched`.
    expect(groups[0]?.tasks.map((t) => t.id)).toEqual(["recent", "quiet", "touched", "same"]);
  });

  it("lists done tasks by their latest activity", () => {
    const groups = groupTasks(
      project(
        [
          {
            name: "Orders",
            tasks: [task("old", { done: true }), task("new", { done: true }), task("none")],
          },
        ],
        [
          hubTask("old", "done", { updatedAt: "2026-10-01T10:00:00Z" }),
          hubTask("new", "done", { updatedAt: "2026-10-11T10:00:00Z" }),
        ],
      ),
    );
    expect(groups.map((group) => [group.id, group.tasks.map((t) => t.id)])).toEqual([
      ["area:Orders", ["none"]],
      ["done", ["new", "old"]],
    ]);
  });
});

describe("overlaps on a task", () => {
  const session = (id: string, email: string, task: string | undefined) => ({
    id,
    workspace: "acme",
    project: "app",
    email,
    label: id,
    status: "working" as const,
    files: [],
    claims: [],
    local: false,
    ...(task === undefined ? {} : { task }),
  });
  const overlap = (id: string, sessions: ReadonlyArray<string>, state: "open" | "resolved") => ({
    id,
    workspace: "acme",
    project: "app",
    sessions,
    files: ["src/pay.ts"],
    state,
  });
  const status = (input: {
    readonly overlaps: ReadonlyArray<ReturnType<typeof overlap>>;
    readonly sessions: ReadonlyArray<ReturnType<typeof session>>;
    readonly enabled?: boolean;
  }) =>
    ({
      email: "me@acme.dev",
      workspaces: [],
      coordination: {
        enabled: input.enabled ?? true,
        sessions: input.sessions,
        overlaps: input.overlaps,
      },
    }) as unknown as PeerHubStatus;
  const where = { workspace: "acme", projectId: "app" };
  const tasks = [
    hubTask("a", "open", { key: "ORD-1", title: "Split the bill" }),
    hubTask("b", "open", { title: "Allergen check" }),
    hubTask("c", "open", { key: "ORD-3" }),
  ];
  const sessions = [
    session("mine", "me@acme.dev", "a"),
    session("eva", "eva@acme.dev", "b"),
    session("loose", "loose@acme.dev", undefined),
    session("mine-too", "me@acme.dev", "a"),
    session("ana", "ana@acme.dev", "a"),
    session("also-mine", "me@acme.dev", undefined),
  ];

  it("marks each task one of the overlap's agents works on, while the overlap is open", () => {
    const open = status({ sessions, overlaps: [overlap("o1", ["mine", "eva"], "open")] });
    expect(taskHasOverlap(open, where, "a")).toBe(true);
    expect(taskHasOverlap(open, where, "b")).toBe(true);
    expect(taskHasOverlap(open, where, "c")).toBe(false);
    const resolved = status({ sessions, overlaps: [overlap("o1", ["mine", "eva"], "resolved")] });
    expect(taskHasOverlap(resolved, where, "a")).toBe(false);
    const off = status({
      sessions,
      overlaps: [overlap("o1", ["mine", "eva"], "open")],
      enabled: false,
    });
    expect(taskHasOverlap(off, where, "a")).toBe(false);
    expect(taskHasOverlap(open, { workspace: "acme", projectId: "web" }, "a")).toBe(false);
  });

  it("names the overlap by the other agent's task, its key before its title", () => {
    const hub = status({
      sessions,
      overlaps: [overlap("o1", ["mine", "eva"], "open")],
    });
    const project = { ...where, tasks };
    expect(taskOverlap(hub, project, "a")).toEqual({ id: "o1", label: "overlaps Allergen check" });
    expect(taskOverlap(hub, project, "b")).toEqual({ id: "o1", label: "overlaps ORD-1" });
    expect(taskOverlap(hub, project, "c")).toBeUndefined();
    const keyed = { ...where, tasks: [tasks[0]!, { ...tasks[1]!, key: "ORD-2" }] };
    expect(taskOverlap(hub, keyed, "a")?.label).toBe("overlaps ORD-2");
  });

  it("names a colleague's agent that works on no task, and says when it is yours", () => {
    const project = { ...where, tasks };
    const colleague = status({ sessions, overlaps: [overlap("o1", ["mine", "loose"], "open")] });
    expect(taskOverlap(colleague, project, "a")?.label).toBe("overlaps Loose’s agent");
    const yours = status({ sessions, overlaps: [overlap("o2", ["mine", "also-mine"], "open")] });
    expect(taskOverlap(yours, project, "a")?.label).toBe("overlaps your other agent");
  });

  it("names the colleague when both agents work on the task", () => {
    const project = { ...where, tasks };
    const both = status({ sessions, overlaps: [overlap("o1", ["mine", "ana"], "open")] });
    expect(taskOverlap(both, project, "a")).toEqual({ id: "o1", label: "overlaps Ana’s agent" });
    const ours = status({ sessions, overlaps: [overlap("o2", ["mine", "mine-too"], "open")] });
    expect(taskOverlap(ours, project, "a")?.label).toBe("overlaps another agent");
  });

  it("opens the first overlap and counts the others", () => {
    const project = { ...where, tasks };
    const hub = status({
      sessions,
      overlaps: [
        overlap("o1", ["mine", "eva"], "open"),
        overlap("o2", ["mine", "loose"], "open"),
        overlap("o3", ["mine", "eva"], "open"),
        overlap("o4", ["mine", "ana"], "resolved"),
      ],
    });
    expect(taskOverlap(hub, project, "a")).toEqual({
      id: "o1",
      label: "overlaps Allergen check +1",
    });
  });

  it("says nothing when the overlap is closed, off, or in another project", () => {
    const project = { ...where, tasks };
    const resolved = status({ sessions, overlaps: [overlap("o1", ["mine", "eva"], "resolved")] });
    expect(taskOverlap(resolved, project, "a")).toBeUndefined();
    const off = status({
      sessions,
      overlaps: [overlap("o1", ["mine", "eva"], "open")],
      enabled: false,
    });
    expect(taskOverlap(off, project, "a")).toBeUndefined();
    const hub = status({ sessions, overlaps: [overlap("o1", ["mine", "eva"], "open")] });
    expect(taskOverlap(hub, { workspace: "acme", projectId: "web", tasks }, "a")).toBeUndefined();
  });
});
