import { describe, expect, it } from "vite-plus/test";

import type { TaskMenuEntry } from "../slots.types";
import { taskMenuItems } from "../workMenus.logic";
import type { WorkTaskNode } from "../workTree.logic";
import { taskMenuAction } from "./taskMenu.logic";

const node: WorkTaskNode = {
  id: "t1",
  key: "ORD-7",
  title: "Order notes header",
  done: false,
  status: "idle",
  threads: [],
  removable: true,
  context: undefined,
};

const dependsOn: TaskMenuEntry = {
  item: {
    id: "depends-on",
    label: "Depends on",
    children: [{ id: "depends:t2", label: "ORD-2" }],
  },
  run: () => {},
};

describe("taskMenuAction", () => {
  it("does what the row's menu does for each of the core choices", () => {
    expect(taskMenuAction("new-thread", [])).toEqual({ kind: "new-chat" });
    expect(taskMenuAction("rename", [])).toEqual({ kind: "rename" });
    expect(taskMenuAction("reopen", [])).toEqual({ kind: "reopen" });
    expect(taskMenuAction("toggle-done", [])).toEqual({ kind: "toggle-done" });
    expect(taskMenuAction("remove", [])).toEqual({ kind: "remove" });
  });

  it("moves between the project's areas, and out of them", () => {
    expect(taskMenuAction("area:Orders", [])).toEqual({ kind: "move-area", area: "Orders" });
    expect(taskMenuAction("no-area", [])).toEqual({ kind: "move-area", area: null });
  });

  it("hands a plugin's item, or one in its submenu, to the plugin", () => {
    expect(taskMenuAction("depends-on", [dependsOn])).toEqual({ kind: "plugin", entry: dependsOn });
    expect(taskMenuAction("depends:t2", [dependsOn])).toEqual({ kind: "plugin", entry: dependsOn });
  });

  it("does nothing for no choice, for the submenu that only opens, and for what it does not know", () => {
    expect(taskMenuAction(null, [dependsOn])).toEqual({ kind: "none" });
    expect(taskMenuAction("move-area", [])).toEqual({ kind: "none" });
    expect(taskMenuAction("something-new", [])).toEqual({ kind: "none" });
  });

  it("understands every item the row's menu offers", () => {
    const items = taskMenuItems({ task: node, canStartThread: true, inReview: true, areas: ["A"] });
    const ids = items.flatMap((item) => [
      item.id,
      ...(item.children?.map((child) => child.id) ?? []),
    ]);
    const unknown = ids.filter(
      (id) => taskMenuAction(id, []).kind === "none" && id !== "move-area",
    );
    expect(unknown).toEqual([]);
  });
});
