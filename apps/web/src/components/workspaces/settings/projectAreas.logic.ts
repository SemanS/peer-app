/**
 * A project's areas as the Areas page edits them. The list is the project's `areas` in the settings
 * document, one ordered value; a task names its area by the same text, so renaming or removing an
 * area also moves its tasks. The page keeps those moves beside the draft and does them once the list
 * is saved (`tasksToMove`), one task update each, the update the Work menus use.
 */

/** The longest area name the Hub takes. */
export const AREA_NAME_MAX = 80;

/** What the page reads of a task. */
export interface AreaTask {
  readonly id: string;
  readonly key?: string | undefined;
  readonly title: string;
  readonly area?: string | undefined;
}

/** Tasks in the area `from` go to the area `to`, or (null) to none, when the list is saved. */
export interface AreaMove {
  readonly from: string;
  readonly to: string | null;
}

/** The list being edited and the moves its changes brought with them. */
export interface AreasEdit {
  readonly areas: ReadonlyArray<string>;
  readonly moves: ReadonlyArray<AreaMove>;
}

/** The names in a document's `areas`, in order; whatever else is in it is left out. */
export function areasOf(value: unknown): ReadonlyArray<string> {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * What to set `areas` to. The Hub leaves an empty list out of the document, so an empty list is no
 * value: setting `[]` over a missing key would count as a change.
 */
export const areasValue = (areas: ReadonlyArray<string>): ReadonlyArray<string> | undefined =>
  areas.length === 0 ? undefined : areas;

export type NameProblem = "empty" | "long" | "taken";

/** Why `name` cannot be an area beside `others`: the Hub wants 1 to 80 characters, each name once. */
export function nameProblem(name: string, others: ReadonlyArray<string>): NameProblem | null {
  const trimmed = name.trim();
  if (trimmed === "") return "empty";
  if (Array.from(trimmed).length > AREA_NAME_MAX) return "long";
  // Two names that differ in case only would read as one to a person.
  const lower = trimmed.toLowerCase();
  return others.some((other) => other.trim().toLowerCase() === lower) ? "taken" : null;
}

export const problemText = (problem: NameProblem): string =>
  problem === "empty"
    ? "Give the area a name."
    : problem === "long"
      ? `Use ${AREA_NAME_MAX} characters or fewer.`
      : "There is an area with that name already.";

/** The area a task names; the Hub takes an empty one as none. */
const areaOf = (task: Pick<AreaTask, "area">): string | undefined =>
  task.area === undefined || task.area === "" ? undefined : task.area;

/** The area a task is in once the moves are done: each task goes where its own area's move says, once. */
export function areaAfter(
  area: string | undefined,
  moves: ReadonlyArray<AreaMove>,
): string | undefined {
  if (area === undefined || area === "") return undefined;
  const move = moves.find((candidate) => candidate.from === area);
  return move === undefined ? area : (move.to ?? undefined);
}

export interface AreaRow {
  readonly name: string;
  /** How many tasks are in it once the moves are done. */
  readonly tasks: number;
}

export interface AreaRows {
  /** The list, in its order. */
  readonly listed: ReadonlyArray<AreaRow>;
  /** Areas that exist only because a task names them, in the order the tasks name them. */
  readonly fromTasks: ReadonlyArray<AreaRow>;
}

/** The rows the page shows: each listed area with its tasks, then the areas only tasks name. */
export function areaRows(
  areas: ReadonlyArray<string>,
  tasks: ReadonlyArray<Pick<AreaTask, "area">>,
  moves: ReadonlyArray<AreaMove> = [],
): AreaRows {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    const area = areaAfter(areaOf(task), moves);
    if (area !== undefined) counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  return {
    listed: areas.map((name) => ({ name, tasks: counts.get(name) ?? 0 })),
    fromTasks: [...counts]
      .filter(([name]) => !areas.includes(name))
      .map(([name, count]) => ({ name, tasks: count })),
  };
}

export const taskCount = (count: number): string => `${count} ${count === 1 ? "task" : "tasks"}`;

/** `areas` with `name` moved to where `over` is. */
export function reorderAreas(
  areas: ReadonlyArray<string>,
  name: string,
  over: string,
): ReadonlyArray<string> {
  const from = areas.indexOf(name);
  const to = areas.indexOf(over);
  if (from < 0 || to < 0 || from === to) return areas;
  const next = [...areas];
  next.splice(from, 1);
  next.splice(to, 0, name);
  return next;
}

/**
 * `moves` with tasks in `from` going to `to`. A move that ended in `from` now ends where this one
 * does, so a task moves once, to its last stop, and a move that would end where it began is dropped.
 */
function withMove(
  moves: ReadonlyArray<AreaMove>,
  from: string,
  to: string | null,
): ReadonlyArray<AreaMove> {
  return [
    ...moves
      .filter((move) => move.from !== from)
      .map((move) => (move.to === from ? { from: move.from, to } : move)),
    { from, to },
  ].filter((move) => move.from !== move.to);
}

/**
 * The list with a new area at its end. An area that was removed earlier in the draft and is added
 * back is the same area again, so its tasks stay where they are.
 */
export function addArea(edit: AreasEdit, name: string): AreasEdit {
  const added = name.trim();
  return {
    areas: [...edit.areas, added],
    moves: edit.moves.filter((move) => move.from !== added),
  };
}

/** Takes an area only tasks name into the list: adding it by its own name. */
export const adoptArea = addArea;

/** The area `from` under a new name, in its place; its tasks follow it. */
export function renameArea(edit: AreasEdit, from: string, to: string): AreasEdit {
  const name = to.trim();
  if (name === from || !edit.areas.includes(from)) return edit;
  return {
    areas: edit.areas.map((area) => (area === from ? name : area)),
    moves: withMove(
      edit.moves.filter((move) => move.from !== name),
      from,
      name,
    ),
  };
}

/** The area out of the list; its tasks go to `to` (another area, or null for none). */
export function removeArea(edit: AreasEdit, name: string, to: string | null): AreasEdit {
  if (!edit.areas.includes(name)) return edit;
  return {
    areas: edit.areas.filter((area) => area !== name),
    moves: withMove(edit.moves, name, to === name ? null : to),
  };
}

/** One task to update: `area` is what to set, an empty text clearing it. */
export interface TaskMove {
  readonly taskId: string;
  readonly label: string;
  readonly from: string;
  readonly area: string;
}

const taskLabelOf = (task: AreaTask) => task.key ?? task.title;

/** The tasks that change area when the moves are done, each with where it goes. */
export function tasksToMove(
  tasks: ReadonlyArray<AreaTask>,
  moves: ReadonlyArray<AreaMove>,
): ReadonlyArray<TaskMove> {
  return tasks.flatMap((task) => {
    const from = areaOf(task);
    const move =
      from === undefined ? undefined : moves.find((candidate) => candidate.from === from);
    return from === undefined || move === undefined
      ? []
      : [{ taskId: task.id, label: taskLabelOf(task), from, area: move.to ?? "" }];
  });
}

/** What saving will do to tasks, a line for each move that has any: for the bar under the list. */
export function moveNotes(
  tasks: ReadonlyArray<Pick<AreaTask, "area">>,
  moves: ReadonlyArray<AreaMove>,
): ReadonlyArray<string> {
  return moves.flatMap((move) => {
    const count = tasks.filter((task) => areaOf(task) === move.from).length;
    if (count === 0) return [];
    return [
      move.to === null
        ? `Saving takes ${taskCount(count)} out of ${move.from}.`
        : `Saving moves ${taskCount(count)} from ${move.from} to ${move.to}.`,
    ];
  });
}

/** A task that could not be moved, and why. */
export interface FailedMove {
  readonly label: string;
  readonly from: string;
  readonly message: string;
}

/**
 * What to tell the person when some moves failed after the list was saved: which tasks stayed, where
 * they are, and what that looks like on the page.
 */
export function failureSummary(
  failed: ReadonlyArray<FailedMove>,
  total: number,
): { readonly title: string; readonly description: string } {
  const first = failed[0];
  if (first === undefined) return { title: "", description: "" };
  const areas = [...new Set(failed.map((move) => move.from))].join(", ");
  return {
    title:
      failed.length === 1
        ? `Could not move ${first.label}`
        : `Could not move ${failed.length} of ${total} tasks`,
    description: `${first.message} ${failed.length === 1 ? "It stays" : "They stay"} in ${areas}, which the page now lists as “from a task”.`,
  };
}
