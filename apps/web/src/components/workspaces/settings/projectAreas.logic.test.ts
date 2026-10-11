import { setAt } from "@t3tools/client-runtime/peer-settings";
import { describe, expect, it } from "vite-plus/test";

import { countChanges, draftSets } from "./settingsDraft.logic";
import {
  addArea,
  adoptArea,
  areaAfter,
  areaRows,
  areasOf,
  areasValue,
  failureSummary,
  moveNotes,
  nameProblem,
  removeArea,
  renameArea,
  reorderAreas,
  tasksToMove,
  type AreaMove,
  type AreaTask,
  type AreasEdit,
} from "./projectAreas.logic";

const task = (id: string, area?: string, key?: string): AreaTask => ({
  id,
  title: `Task ${id}`,
  ...(area === undefined ? {} : { area }),
  ...(key === undefined ? {} : { key }),
});

const edit = (areas: ReadonlyArray<string>, moves: ReadonlyArray<AreaMove> = []): AreasEdit => ({
  areas,
  moves,
});

describe("reading and writing the list", () => {
  it("reads the names a document holds and leaves anything else out", () => {
    expect(areasOf(["Payments", 3, null, "Reservations"])).toEqual(["Payments", "Reservations"]);
    expect(areasOf(undefined)).toEqual([]);
    expect(areasOf("Payments")).toEqual([]);
  });

  it("sets no value for an empty list, as the Hub leaves it out of the document", () => {
    expect(areasValue([])).toBeUndefined();
    expect(areasValue(["Payments"])).toEqual(["Payments"]);
  });
});

describe("naming an area", () => {
  it.each([
    ["", ["Payments"], "empty"],
    ["   ", ["Payments"], "empty"],
    ["x".repeat(81), [], "long"],
    ["payments", ["Payments"], "taken"],
    ["  Payments ", ["Payments"], "taken"],
  ] as const)("refuses %j beside %j: %s", (name, others, problem) => {
    expect(nameProblem(name, others)).toBe(problem);
  });

  it("takes 80 characters, counting what a person sees as one", () => {
    expect(nameProblem("x".repeat(80), [])).toBeNull();
    expect(nameProblem("é".repeat(80), [])).toBeNull();
    expect(nameProblem("😀".repeat(80), [])).toBeNull();
    expect(nameProblem("😀".repeat(81), [])).toBe("long");
  });

  it("takes a name no other area has", () => {
    expect(nameProblem("Integrations", ["Payments", "Reservations"])).toBeNull();
  });
});

describe("the rows", () => {
  const tasks = [
    task("1", "Payments"),
    task("2", "Payments"),
    task("3", "Reservations"),
    task("4", "Partner portal"),
    task("5"),
    task("6", ""),
  ];

  it("counts the tasks in each listed area, in the list's order", () => {
    expect(areaRows(["Reservations", "Payments", "Integrations"], tasks).listed).toEqual([
      { name: "Reservations", tasks: 1 },
      { name: "Payments", tasks: 2 },
      { name: "Integrations", tasks: 0 },
    ]);
  });

  it("lists an area only a task names, apart from the list, and not tasks in no area", () => {
    expect(areaRows(["Payments", "Reservations"], tasks).fromTasks).toEqual([
      { name: "Partner portal", tasks: 1 },
    ]);
    expect(areaRows(["Payments", "Reservations", "Partner portal"], tasks).fromTasks).toEqual([]);
  });

  it("lists areas that only tasks name in the order the tasks name them", () => {
    const named = [task("1", "B"), task("2", "A"), task("3", "B")];
    expect(areaRows([], named).fromTasks).toEqual([
      { name: "B", tasks: 2 },
      { name: "A", tasks: 1 },
    ]);
  });

  it("counts the tasks as they will be once the moves are done", () => {
    const rows = areaRows(["Reservations"], tasks, [{ from: "Payments", to: "Reservations" }]);
    expect(rows.listed).toEqual([{ name: "Reservations", tasks: 3 }]);
    expect(areaRows(["Reservations"], tasks, [{ from: "Payments", to: null }]).listed).toEqual([
      { name: "Reservations", tasks: 1 },
    ]);
  });

  it("puts a task where its own area's move says, once", () => {
    const moves = [
      { from: "A", to: "B" },
      { from: "B", to: "C" },
    ];
    expect(areaAfter("A", moves)).toBe("B");
    expect(areaAfter("B", moves)).toBe("C");
    expect(areaAfter(undefined, moves)).toBeUndefined();
    expect(areaAfter("", moves)).toBeUndefined();
    expect(areaAfter("Z", moves)).toBe("Z");
  });
});

describe("changing the list", () => {
  it("reorders by moving an area to where another is", () => {
    const areas = ["A", "B", "C", "D"];
    expect(reorderAreas(areas, "A", "C")).toEqual(["B", "C", "A", "D"]);
    expect(reorderAreas(areas, "D", "B")).toEqual(["A", "D", "B", "C"]);
    expect(reorderAreas(areas, "B", "B")).toBe(areas);
    expect(reorderAreas(areas, "B", "missing")).toBe(areas);
  });

  it("adds an area at the end, trimmed", () => {
    expect(addArea(edit(["A"]), "  B ")).toEqual(edit(["A", "B"]));
  });

  it("adopts an area only tasks name by adding it, its tasks staying where they are", () => {
    expect(adoptArea(edit(["A"]), "Partner portal")).toEqual(edit(["A", "Partner portal"]));
  });

  it("renames in place and moves the area's tasks after it", () => {
    expect(renameArea(edit(["A", "B", "C"]), "B", " Billing ")).toEqual(
      edit(["A", "Billing", "C"], [{ from: "B", to: "Billing" }]),
    );
  });

  it("does nothing for a rename to the same name or of an area that is not there", () => {
    const start = edit(["A", "B"]);
    expect(renameArea(start, "A", " A ")).toBe(start);
    expect(renameArea(start, "Z", "Y")).toBe(start);
  });

  it("sends a task once to the last name when an area is renamed twice", () => {
    const first = renameArea(edit(["W"]), "W", "X");
    const second = renameArea(first, "X", "Y");
    expect(second.areas).toEqual(["Y"]);
    expect(second.moves).toEqual([
      { from: "W", to: "Y" },
      { from: "X", to: "Y" },
    ]);
  });

  it("moves nothing when an area is renamed and renamed back", () => {
    const there = renameArea(edit(["Payments", "B"]), "Payments", "Billing");
    const back = renameArea(there, "Billing", "Payments");
    expect(back.areas).toEqual(["Payments", "B"]);
    // Nothing names Billing, so the move left over moves no task.
    expect(tasksToMove([task("1", "Payments")], back.moves)).toEqual([]);
  });

  it("removes an area and sends its tasks to another", () => {
    expect(removeArea(edit(["A", "B", "C"]), "B", "C")).toEqual(
      edit(["A", "C"], [{ from: "B", to: "C" }]),
    );
  });

  it("removes an area and takes its tasks out of any area", () => {
    expect(removeArea(edit(["A", "B"]), "A", null)).toEqual(edit(["B"], [{ from: "A", to: null }]));
  });

  it("sends the tasks that were headed for a removed area to where it sends its own", () => {
    const first = removeArea(edit(["A", "B", "C"]), "A", "B");
    const second = removeArea(first, "B", "C");
    expect(second.areas).toEqual(["C"]);
    expect(second.moves).toEqual([
      { from: "A", to: "C" },
      { from: "B", to: "C" },
    ]);
    const tasks = [task("1", "A"), task("2", "B"), task("3", "C")];
    expect(areaRows(second.areas, tasks, second.moves).listed).toEqual([{ name: "C", tasks: 3 }]);
  });

  it("sends the tasks of a renamed area where a later removal sends it", () => {
    const first = renameArea(edit(["A", "B"]), "A", "Alpha");
    const second = removeArea(first, "Alpha", null);
    expect(second.moves).toEqual([
      { from: "A", to: null },
      { from: "Alpha", to: null },
    ]);
  });

  it("keeps the tasks of a removed area in it when the area is added back", () => {
    const removed = removeArea(edit(["A", "B"]), "A", "B");
    const back = addArea(removed, "A");
    expect(back.areas).toEqual(["B", "A"]);
    expect(back.moves).toEqual([]);
  });

  it("does not remove an area that is not in the list", () => {
    const start = edit(["A"]);
    expect(removeArea(start, "Z", null)).toBe(start);
  });

  it("never moves an area's tasks into the area it removes", () => {
    expect(removeArea(edit(["A", "B"]), "A", "A").moves).toEqual([{ from: "A", to: null }]);
  });
});

describe("moving the tasks after the save", () => {
  const tasks = [
    task("1", "Payments", "BKG-1"),
    task("2", "Payments"),
    task("3", "Reservations"),
    task("4"),
  ];

  it("names each task of a moved area, with where it goes", () => {
    expect(tasksToMove(tasks, [{ from: "Payments", to: "Reservations" }])).toEqual([
      { taskId: "1", label: "BKG-1", from: "Payments", area: "Reservations" },
      { taskId: "2", label: "Task 2", from: "Payments", area: "Reservations" },
    ]);
  });

  it("clears the area of a task that goes to none", () => {
    expect(tasksToMove(tasks, [{ from: "Reservations", to: null }])).toEqual([
      { taskId: "3", label: "Task 3", from: "Reservations", area: "" },
    ]);
  });

  it("moves no task of an area that has no move, nor one that is in none", () => {
    expect(tasksToMove(tasks, [{ from: "Integrations", to: null }])).toEqual([]);
    expect(tasksToMove(tasks, [])).toEqual([]);
  });

  it("moves each task once, by the area it is in now", () => {
    const moves = [
      { from: "Payments", to: "Reservations" },
      { from: "Reservations", to: null },
    ];
    expect(tasksToMove(tasks, moves).map(({ taskId, area }) => [taskId, area])).toEqual([
      ["1", "Reservations"],
      ["2", "Reservations"],
      ["3", ""],
    ]);
  });

  it("tells what saving will do, for each move that has tasks", () => {
    expect(
      moveNotes(tasks, [
        { from: "Payments", to: "Reservations" },
        { from: "Reservations", to: null },
        { from: "Integrations", to: "Payments" },
      ]),
    ).toEqual([
      "Saving moves 2 tasks from Payments to Reservations.",
      "Saving takes 1 task out of Reservations.",
    ]);
    expect(moveNotes(tasks, [])).toEqual([]);
  });
});

describe("telling what did not move", () => {
  it("names the task, and says where it stayed", () => {
    expect(
      failureSummary([{ label: "BKG-1", from: "Payments", message: "Hub is down." }], 2),
    ).toEqual({
      title: "Could not move BKG-1",
      description: "Hub is down. It stays in Payments, which the page now lists as “from a task”.",
    });
  });

  it("counts them when several stayed, and names each area once", () => {
    const failed = [
      { label: "A", from: "Payments", message: "No." },
      { label: "B", from: "Payments", message: "No." },
      { label: "C", from: "Reservations", message: "No." },
    ];
    expect(failureSummary(failed, 6)).toEqual({
      title: "Could not move 3 of 6 tasks",
      description:
        "No. They stay in Payments, Reservations, which the page now lists as “from a task”.",
    });
  });
});

describe("what the draft saves", () => {
  const slice = ["projects", "booking"] as const;
  const path = ["projects", "booking", "areas"];
  const base = { projects: { booking: { name: "Booking", areas: ["Payments", "Reservations"] } } };
  const draftOf = (edited: AreasEdit) => setAt(base, path, areasValue(edited.areas));

  it("saves a reorder as the new list, one change", () => {
    const draft = draftOf({
      areas: reorderAreas(["Payments", "Reservations"], "Payments", "Reservations"),
      moves: [],
    });
    expect(countChanges(base, draft, slice)).toBe(1);
    expect(draftSets(base, draft, slice)).toEqual([{ path, value: ["Reservations", "Payments"] }]);
  });

  it("has nothing to save once a reorder is put back", () => {
    const there = reorderAreas(["Payments", "Reservations"], "Payments", "Reservations");
    const back = reorderAreas(there, "Payments", "Reservations");
    expect(countChanges(base, draftOf({ areas: back, moves: [] }), slice)).toBe(0);
  });

  it("saves a rename, a removal and an adoption as the list they make", () => {
    const start = edit(["Payments", "Reservations"]);
    expect(draftSets(base, draftOf(renameArea(start, "Payments", "Billing")), slice)).toEqual([
      { path, value: ["Billing", "Reservations"] },
    ]);
    expect(draftSets(base, draftOf(removeArea(start, "Payments", "Reservations")), slice)).toEqual([
      { path, value: ["Reservations"] },
    ]);
    expect(draftSets(base, draftOf(adoptArea(start, "Partner portal")), slice)).toEqual([
      { path, value: ["Payments", "Reservations", "Partner portal"] },
    ]);
  });

  it("saves the removal of the last area as taking the key out, as the Hub leaves it out", () => {
    const one = { projects: { booking: { name: "Booking", areas: ["Payments"] } } };
    const none = setAt(
      one,
      path,
      areasValue(removeArea(edit(["Payments"]), "Payments", null).areas),
    );
    expect(draftSets(one, none, slice)).toEqual([{ path, value: null }]);
  });

  it("saves nothing for a project without areas that still has none", () => {
    const empty = { projects: { booking: { name: "Booking" } } };
    expect(countChanges(empty, setAt(empty, path, areasValue([])), slice)).toBe(0);
  });
});
