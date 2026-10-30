import { describe, expect, it } from "vite-plus/test";

import { openAreasByDefault, sidebarTasks, tasksCountLabel } from "./sidebarTasks.logic";
import type { WorkProjectNode, WorkTaskNode } from "./workTree.logic";

const node = (id: string, fields: Partial<WorkTaskNode> = {}): WorkTaskNode => ({
  id,
  key: undefined,
  title: id,
  done: false,
  status: "idle",
  threads: [],
  removable: false,
  context: undefined,
  kind: "task",
  ...fields,
});

const projectOf = (
  areas: ReadonlyArray<{ readonly name: string | null; readonly tasks: Array<WorkTaskNode> }>,
) => ({ areas, tasks: [] }) as unknown as WorkProjectNode;

const change = () =>
  projectOf([
    {
      name: null,
      tasks: [
        node("change", { kind: "group", title: "Survey editor concurrency" }),
        node("contracts", { kind: "group", parent: "change", title: "Contracts" }),
        node("1.1", { parent: "contracts", done: true }),
        node("1.2", { parent: "contracts" }),
        node("revision", { kind: "group", parent: "change", title: "Revision tracking" }),
        node("2.1", { parent: "revision" }),
      ],
    },
  ]);

describe("sidebarTasks", () => {
  it("makes a change's groups its areas and counts work only", () => {
    const tasks = sidebarTasks(change());
    expect(tasks.change).toBe("Survey editor concurrency");
    expect(tasks.total).toBe(3);
    expect(
      tasks.areas.map((area) => [area.title, area.done, area.total, area.open.length]),
    ).toEqual([
      ["Contracts", 1, 2, 1],
      ["Revision tracking", 0, 1, 1],
    ]);
  });

  it("keeps a flat project's areas and names no change", () => {
    const tasks = sidebarTasks(
      projectOf([
        { name: "Billing", tasks: [node("a"), node("b", { done: true })] },
        { name: null, tasks: [node("c")] },
      ]),
    );
    expect(tasks.change).toBeUndefined();
    expect(tasks.areas.map((area) => area.title)).toEqual(["Billing", "No area"]);
    expect(tasks.areas[0]?.finished.map((row) => row.item.id)).toEqual(["b"]);
  });

  it("names no change while two are open", () => {
    const project = projectOf([
      {
        name: null,
        tasks: [
          node("one", { kind: "group" }),
          node("one-a", { kind: "group", parent: "one" }),
          node("two", { kind: "group" }),
          node("two-a", { kind: "group", parent: "two" }),
          node("task", { parent: "two-a" }),
        ],
      },
    ]);
    expect(sidebarTasks(project).change).toBeUndefined();
  });
});

describe("openAreasByDefault", () => {
  it("opens the first area with open work and the one the open task is in", () => {
    const { areas } = sidebarTasks(change());
    expect([...openAreasByDefault(areas, "2.1")]).toEqual([areas[0]?.id, areas[1]?.id]);
    expect([...openAreasByDefault(areas, undefined)]).toEqual([areas[0]?.id]);
  });
});

describe("tasksCountLabel", () => {
  it("counts in words", () => {
    expect(tasksCountLabel(1)).toBe("1 task");
    expect(tasksCountLabel(24)).toBe("24 tasks");
  });
});
