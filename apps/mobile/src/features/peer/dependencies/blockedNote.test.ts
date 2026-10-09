import { describe, expect, it } from "vite-plus/test";

import { blockedNote } from "./blockedNote";
describe("mobile blocker note", () => {
  it("clears on close and never presents unavailable facts", () => {
    const task = {
        id: "b",
        title: "B",
        status: "open" as const,
        createdAt: "",
        updatedAt: "",
        createdBy: "ana",
      },
      dependency = { ...task, id: "a", key: "VL1" };
    const props = {
      workspace: "acme",
      task,
      project: { project: { id: "app" }, work: { tasks: [task, dependency], threads: [] } },
      status: {
        dependencies: [{ workspace: "acme", available: true, projects: { app: { b: ["a"] } } }],
      },
    };
    expect(blockedNote(props)).toBe("· blocked by VL1");
    expect(
      blockedNote({
        ...props,
        task: { ...task, status: "done" },
        project: {
          ...props.project,
          work: { ...props.project.work, tasks: [{ ...task, status: "done" }, dependency] },
        },
      }),
    ).toBeNull();
    expect(blockedNote({ ...props, status: { ...props.status, dependencies: [] } })).toBeNull();
  });
});
