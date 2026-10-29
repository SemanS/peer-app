/**
 * The terminal tree `Invite a teammate` picks a scope with: all areas and tasks, whole areas (which
 * cover their future tasks too), or single tasks, an area opening to show its tasks. Selecting is a
 * pure reducer over a small state, so the rules (an area's tasks are not assigned twice, a partly
 * chosen area shows `[-]`) are tested without a terminal; `treePrompt` draws it with Effect's
 * custom prompt.
 *
 * @module cli/peerCoreTree
 */
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Prompt } from "effect/cli";

export interface TreeTask {
  readonly id: string;
  readonly title: string;
  /** Who owns it now, when somebody does. */
  readonly owner?: string;
  /** Imported from an OpenSpec change. */
  readonly openspec?: boolean;
}

export interface TreeArea {
  /** null: the tasks that have no area (chosen one by one, they cover no future task). */
  readonly name: string | null;
  readonly owner?: string;
  readonly tasks: ReadonlyArray<TreeTask>;
}

/** What was chosen: everything, whole areas, and single tasks outside them. */
export interface Selection {
  readonly all: boolean;
  readonly areas: ReadonlyArray<string>;
  readonly tasks: ReadonlyArray<string>;
}

export interface TreeState {
  readonly areas: ReadonlyArray<TreeArea>;
  readonly cursor: number;
  readonly open: ReadonlyArray<string | null>;
  readonly all: boolean;
  readonly whole: ReadonlyArray<string>;
  readonly tasks: ReadonlyArray<string>;
}

export type Row =
  | { readonly kind: "all" }
  | { readonly kind: "area"; readonly area: TreeArea }
  | { readonly kind: "areaAll"; readonly area: TreeArea }
  | { readonly kind: "task"; readonly area: TreeArea; readonly task: TreeTask }
  | { readonly kind: "continue" };

export const initialTree = (areas: ReadonlyArray<TreeArea>): TreeState => ({
  areas: areas.filter((area) => area.name !== null || area.tasks.length > 0),
  cursor: 0,
  open: [],
  all: false,
  whole: [],
  tasks: [],
});

export const rows = (state: TreeState): ReadonlyArray<Row> => [
  { kind: "all" },
  ...state.areas.flatMap((area): ReadonlyArray<Row> =>
    state.open.includes(area.name)
      ? [
          { kind: "area", area },
          ...(area.name === null ? [] : [{ kind: "areaAll" as const, area }]),
          ...area.tasks.map((task) => ({ kind: "task" as const, area, task })),
        ]
      : [{ kind: "area", area }],
  ),
  { kind: "continue" },
];

type Mark = "on" | "off" | "some";

const areaMark = (state: TreeState, area: TreeArea): Mark => {
  if (state.all || (area.name !== null && state.whole.includes(area.name))) return "on";
  const chosen = area.tasks.filter((task) => state.tasks.includes(task.id)).length;
  if (chosen === 0) return "off";
  // A group without an area is all of its tasks; a real area is whole only when chosen as one.
  return area.name === null && chosen === area.tasks.length ? "on" : "some";
};

export const mark = (state: TreeState, row: Row): Mark => {
  switch (row.kind) {
    case "all":
      return state.all ? "on" : "off";
    case "area":
      return areaMark(state, row.area);
    case "areaAll":
      return state.all || state.whole.includes(row.area.name!) ? "on" : "off";
    case "task":
      return state.all ||
        (row.area.name !== null && state.whole.includes(row.area.name)) ||
        state.tasks.includes(row.task.id)
        ? "on"
        : "off";
    case "continue":
      return "off";
  }
};

/** "All" as what it stands for, so one part of it can be taken away. */
const spread = (state: TreeState): TreeState =>
  state.all
    ? {
        ...state,
        all: false,
        whole: state.areas.flatMap((a) => (a.name === null ? [] : [a.name])),
        tasks: state.areas.filter((a) => a.name === null).flatMap((a) => a.tasks.map((t) => t.id)),
      }
    : state;

const without = <A>(list: ReadonlyArray<A>, drop: ReadonlyArray<A>) =>
  list.filter((item) => !drop.includes(item));

/** Space on a row: what it selects or clears, never one task twice. */
export const toggle = (state: TreeState, row: Row): TreeState => {
  if (row.kind === "continue") return state;
  if (row.kind === "all") return { ...state, all: !state.all, whole: [], tasks: [] };
  const next = spread(state);
  const ids = row.area.tasks.map((task) => task.id);
  if (row.kind === "area" || row.kind === "areaAll") {
    const on = areaMark(next, row.area) === "on";
    if (row.area.name === null)
      return {
        ...next,
        tasks: on ? without(next.tasks, ids) : [...without(next.tasks, ids), ...ids],
      };
    const name = row.area.name;
    // A whole area covers its tasks: the single ones in it are not kept beside it.
    return on
      ? { ...next, whole: without(next.whole, [name]), tasks: without(next.tasks, ids) }
      : { ...next, whole: [...next.whole, name], tasks: without(next.tasks, ids) };
  }
  const name = row.area.name;
  if (name !== null && next.whole.includes(name))
    // Taking one task out of a whole area leaves the rest as single tasks.
    return {
      ...next,
      whole: without(next.whole, [name]),
      tasks: [...without(next.tasks, ids), ...without(ids, [row.task.id])],
    };
  return next.tasks.includes(row.task.id)
    ? { ...next, tasks: without(next.tasks, [row.task.id]) }
    : { ...next, tasks: [...next.tasks, row.task.id] };
};

export const selection = (state: TreeState): Selection => ({
  all: state.all,
  areas: state.all ? [] : state.whole,
  tasks: state.all ? [] : state.tasks,
});

/** The chosen scope in lines, as the confirmation shows it. */
export const describe = (areas: ReadonlyArray<TreeArea>, chosen: Selection) => {
  if (chosen.all) return ["✓ All areas and tasks"];
  const lines = chosen.areas.map((name) => `✓ ${name} — all tasks, and new ones`);
  for (const area of areas) {
    const picked = area.tasks.filter((task) => chosen.tasks.includes(task.id));
    if (picked.length === 0) continue;
    lines.push(
      `✓ ${area.name ?? "No area"} — ${picked.length === 1 ? picked[0]!.title : `${picked.length} tasks`}`,
    );
  }
  return lines;
};

const box = (state: Mark) => (state === "on" ? "[x]" : state === "some" ? "[-]" : "[ ]");
const clip = (text: string, width: number) =>
  text.length <= width ? text : `${text.slice(0, Math.max(width - 1, 1))}…`;

const label = (state: TreeState, row: Row) => {
  switch (row.kind) {
    case "all":
      return `${box(mark(state, row))} All areas and tasks`;
    case "area": {
      const arrow = state.open.includes(row.area.name) ? "▾" : "▸";
      const owner = row.area.owner === undefined ? "" : ` · ${row.area.owner}'s`;
      return `${arrow} ${box(mark(state, row))} ${row.area.name ?? "No area"} (${row.area.tasks.length})${owner}`;
    }
    case "areaAll":
      return `    ${box(mark(state, row))} All tasks in ${row.area.name}`;
    case "task": {
      const tags = [
        ...(row.task.openspec === true ? ["OpenSpec"] : []),
        ...(row.task.owner === undefined ? [] : [`${row.task.owner}'s`]),
      ];
      return `    ${box(mark(state, row))} ${row.task.title}${tags.length === 0 ? "" : ` · ${tags.join(" · ")}`}`;
    }
    case "continue":
      return "Continue";
  }
};

const VISIBLE = 16;
const HINT = "↑↓ move · space select · → open · ← close · Enter on Continue";

/** The frame: a window of rows around the cursor, each one line at most `width` wide. */
export const frame = (state: TreeState, message: string, width = 80) => {
  const all = rows(state);
  const start = Math.max(0, Math.min(state.cursor - Math.floor(VISIBLE / 2), all.length - VISIBLE));
  const shown = all.slice(start, start + VISIBLE);
  return [
    `? ${message}`,
    ...(start > 0 ? ["  ↑ more"] : []),
    ...shown.map((row, index) =>
      clip(`${start + index === state.cursor ? "❯ " : "  "}${label(state, row)}`, width),
    ),
    ...(start + VISIBLE < all.length ? ["  ↓ more"] : []),
    clip(HINT, width),
  ];
};

/** A key, as the prompt hands it: what becomes of the state, or the selection when done. */
export const press = (
  state: TreeState,
  key: string,
): { readonly state: TreeState } | { readonly done: Selection } => {
  const all = rows(state);
  const row = all[state.cursor]!;
  const move = (cursor: number) => ({ state: { ...state, cursor } });
  const area =
    row.kind === "area" || row.kind === "areaAll" || row.kind === "task" ? row.area : null;
  switch (key) {
    case "up":
      return move((state.cursor - 1 + all.length) % all.length);
    case "down":
    case "tab":
      return move((state.cursor + 1) % all.length);
    case "space":
      return { state: toggle(state, row) };
    case "right":
      return area === null || state.open.includes(area.name)
        ? { state }
        : { state: { ...state, open: [...state.open, area.name] } };
    case "left": {
      if (area === null || !state.open.includes(area.name)) return { state };
      const closed = { ...state, open: state.open.filter((name) => name !== area.name) };
      return {
        state: {
          ...closed,
          cursor: rows(closed).findIndex((r) => r.kind === "area" && r.area === area),
        },
      };
    }
    case "enter":
    case "return":
      if (row.kind === "continue") return { done: selection(state) };
      if (row.kind === "area")
        return press(state, state.open.includes(row.area.name) ? "left" : "right");
      return { state: toggle(state, row) };
    default:
      return { state };
  }
};

type Action = Prompt.Action<TreeState, Selection>;
const Action = Data.taggedEnum<Action>();

/** The tree as a terminal prompt. */
export const treePrompt = (message: string, areas: ReadonlyArray<TreeArea>) => {
  let drawn = 0;
  const erase = () => {
    const text = drawn === 0 ? "" : `${"\x1b[2K\x1b[1A".repeat(drawn - 1)}\x1b[2K\x1b[G`;
    return text;
  };
  return Prompt.Custom<TreeState, Selection>(initialTree(areas), {
    render: (state, action) =>
      Effect.sync(() => {
        if (action._tag === "Submit") {
          drawn = 1;
          return `✔ ${message}`;
        }
        const lines = frame(
          state,
          message,
          (process.stdout.columns ?? 0) > 20 ? process.stdout.columns - 1 : 80,
        );
        drawn = lines.length;
        return `\x1b[?25l${lines.join("\n")}`;
      }),
    process: (input, state) =>
      Effect.sync((): Action => {
        const name =
          input.key.name === "" ? Option.getOrElse(input.input, () => "") : input.key.name;
        const next = press(state, name === " " ? "space" : name);
        return "done" in next
          ? Action.Submit({ value: next.done })
          : Action.NextFrame({ state: next.state });
      }),
    clear: () => Effect.sync(erase),
  });
};
