import { describe, expect, it } from "vite-plus/test";
import {
  filterCommandPaletteGroups,
  findHighlightedCommandPaletteItem,
} from "../CommandPalette.logic";
import { BOB, workProject } from "./ownership/ownership.testkit";
import { taskSearchItems } from "./taskSearch.logic";

const project = workProject(BOB);
function search(query: string, options: { actions?: boolean; submenu?: boolean } = {}) {
  const unstarted = {
    ...project.areas[0]!.tasks[0]!,
    title: "Overiť preklad cez nakonfigurovaný model",
    threads: [],
    status: "idle" as const,
    inReview: false,
    done: false,
  };
  const tree = [
    {
      ...project,
      projectId: "elsewhere",
      areas: [{ name: null, tasks: [{ ...unstarted, id: "other", done: true }] }],
    },
    { ...project, areas: [{ name: null, tasks: [unstarted] }] },
  ];
  const opened: unknown[] = [];
  const items = taskSearchItems({
    tree,
    scope: `${project.workspace}/${project.projectId}`,
    needs: [],
    me: BOB,
    icon: null,
    open: async (target) => {
      opened.push(target);
    },
  });
  const groups = filterCommandPaletteGroups({
    activeGroups: [],
    query: options.actions ? `>${query}` : query,
    isInSubmenu: options.submenu ?? false,
    taskSearchItems: items,
    projectSearchItems: [],
    threadSearchItems: [
      {
        kind: "action",
        value: "thread:match",
        title: "Old conversation",
        searchTerms: ["Old conversation", "preklad"],
        icon: null,
        run: async () => {},
      },
    ],
  });
  return { groups, opened };
}

describe("task search", () => {
  it("finds a task without any chats, ahead of transcript matches", () => {
    const { groups } = search("preklad");
    expect(groups.map((group) => group.label)).toEqual(["Tasks", "Threads"]);
    expect(groups[0]!.items[0]!.description).toContain("Not started");
  });
  it("matches diacritics and keeps the selected project's identical title first", () => {
    const { groups } = search("overit nakonfigurovany");
    expect(groups[0]!.items.map((item) => item.value)).toEqual([
      `task:${project.workspace}:${project.projectId}:${project.areas[0]!.tasks[0]!.id}`,
      `task:${project.workspace}:elsewhere:other`,
    ]);
    expect(groups[0]!.items[1]!.description).toContain("Done");
  });
  it("opens the exact task from the keyboard-highlighted result", async () => {
    const { groups, opened } = search("preklad");
    const item = findHighlightedCommandPaletteItem(groups, groups[0]!.items[0]!.value);
    if (item?.kind !== "action") throw new Error("Task result missing");
    await item.run();
    expect(opened).toEqual([
      {
        workspace: project.workspace,
        project: project.projectId,
        task: project.areas[0]!.tasks[0]!.id,
      },
    ]);
  });
  it("keeps tasks out of action-only search, submenus and the empty-query home", () => {
    expect(search("preklad", { actions: true }).groups).toEqual([]);
    expect(search("preklad", { submenu: true }).groups).toEqual([]);
    expect(search("").groups).toEqual([]);
  });
});
