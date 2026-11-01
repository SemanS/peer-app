/**
 * The terminal tree of a project's work: areas, then groups and tasks nested under them, a row
 * opening to show its items. `Start a task` marks scopes in it (an area, a group or a task each,
 * `treeStartPrompt`), Enter alone picking one row while nothing is marked. It is a pure reducer over
 * a small state, so the rules (a whole node covers its subtree, a partly chosen one shows `[-]`, no
 * task is chosen twice) are tested without a terminal; the prompt draws it with Effect's custom
 * prompt.
 *
 * @module cli/peerCoreTree
 */
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Prompt } from "effect/cli";

export type TreeNodeKind = "area" | "group" | "task";

export interface TreeNode {
  /** A task's id; an area's name, "" for the tasks without an area. */
  readonly id: string;
  readonly title: string;
  readonly kind: TreeNodeKind;
  /** A person has to decide whether it runs as one task or by its parts. */
  readonly unsettled?: boolean;
  /** It may be given to an agent and run as one (default: not a group). */
  readonly executable?: boolean;
  /** As the Hub shows it (a parent's is the aggregate of its items). */
  readonly status?: "open" | "review" | "done";
  /** Over its executable items, when it has any. */
  readonly progress?: { readonly done: number; readonly total: number };
  /** A task may have items too. */
  readonly children: ReadonlyArray<TreeNode>;
}

/** The area node of a name, or of the tasks without an area. */
export const areaNode = (name: string | null, children: ReadonlyArray<TreeNode>): TreeNode => ({
  id: name ?? "",
  title: name ?? "No area",
  kind: "area",
  children,
});

/** A row the caller adds that is no scope (`New task…`): its id starts with `\0`, it has no box. */
export const isAction = (node: TreeNode) => node.id.startsWith("\0");

export const isExecutableNode = (node: TreeNode) =>
  node.kind !== "area" && (node.executable ?? node.kind !== "group");

/** Every node under `node`, depth first, in tree order. */
export const descendants = (node: TreeNode): ReadonlyArray<TreeNode> =>
  node.children.flatMap((child) => [child, ...descendants(child)]);

/** The nodes from an area down to the one with `id` (an area's own id when `kind` is "area"). */
export const pathTo = (
  nodes: ReadonlyArray<TreeNode>,
  target: { readonly kind: TreeNodeKind; readonly id: string },
): ReadonlyArray<TreeNode> | null => {
  const walk = (node: TreeNode, path: ReadonlyArray<TreeNode>): ReadonlyArray<TreeNode> | null => {
    const here = [...path, node];
    if ((node.kind === "area") === (target.kind === "area") && node.id === target.id) return here;
    for (const child of node.children) {
      const found = walk(child, here);
      if (found !== null) return found;
    }
    return null;
  };
  for (const node of nodes) {
    const found = walk(node, []);
    if (found !== null) return found;
  }
  return null;
};

/** The open executable items under a node (or the node itself, when it runs as one), in order. */
export const openItems = (node: TreeNode): ReadonlyArray<TreeNode> =>
  descendants(node).filter(
    (item) => isExecutableNode(item) && item.status !== "done" && item.status !== "review",
  );

/** The key a node is opened by: areas and tasks are told apart, an area's id being its name. */
const keyOf = (node: TreeNode) => `${node.kind === "area" ? "a" : "t"}:${node.id}`;

export interface NodeRow {
  readonly kind: "node";
  readonly node: TreeNode;
  /** The nodes above it, its area first. */
  readonly path: ReadonlyArray<TreeNode>;
}

export type Row = NodeRow | { readonly kind: "continue" };

/** The node rows that show while `open` holds the opened keys. */
const nodeRows = (
  nodes: ReadonlyArray<TreeNode>,
  open: ReadonlyArray<string>,
): ReadonlyArray<NodeRow> => {
  const walk = (node: TreeNode, path: ReadonlyArray<TreeNode>): ReadonlyArray<NodeRow> => {
    const row: NodeRow = { kind: "node", node, path };
    if (!open.includes(keyOf(node)) || node.children.length === 0) return [row];
    const below = [...path, node];
    return [row, ...node.children.flatMap((child) => walk(child, below))];
  };
  return nodes.flatMap((node) => walk(node, []));
};

const box = (state: Mark) => (state === "on" ? "[x]" : state === "some" ? "[-]" : "[ ]");
const clip = (text: string, width: number) =>
  text.length <= width ? text : `${text.slice(0, Math.max(width - 1, 1))}…`;

/** A node's row: `▸ [ ] 2. Hub feature (3/8) ?`, the box left out on an action row. */
const nodeLabel = (row: NodeRow, opened: boolean, mark: Mark | null) => {
  const { node } = row;
  const arrow = node.children.length === 0 ? " " : opened ? "▾" : "▸";
  const indent = node.kind === "area" ? "" : "  ".repeat(row.path.length);
  const count =
    node.kind === "area"
      ? ` (${descendants(node).length})`
      : node.progress === undefined
        ? ""
        : ` (${node.progress.done}/${node.progress.total})`;
  return `${indent}${arrow} ${mark === null ? "" : `${box(mark)} `}${node.title}${count}${node.unsettled === true ? " ?" : ""}`;
};

const VISIBLE = 16;

/** A window of rows around the cursor, each one line at most `width` wide. */
const windowed = (
  message: string,
  labels: ReadonlyArray<string>,
  cursor: number,
  hint: string,
  width: number,
) => {
  const start = Math.max(0, Math.min(cursor - Math.floor(VISIBLE / 2), labels.length - VISIBLE));
  const shown = labels.slice(start, start + VISIBLE);
  return [
    `? ${message}`,
    ...(start > 0 ? ["  ↑ more"] : []),
    ...shown.map((label, index) =>
      clip(`${start + index === cursor ? "❯ " : "  "}${label}`, width),
    ),
    ...(start + VISIBLE < labels.length ? ["  ↓ more"] : []),
    clip(hint, width),
  ];
};

/** → opens the row's node; ← closes it, or, on a row inside an open node, closes that one. */
const openOrClose = (
  open: ReadonlyArray<string>,
  row: NodeRow,
  key: "right" | "left",
): { readonly open: ReadonlyArray<string>; readonly focus: TreeNode } | null => {
  const own = keyOf(row.node);
  if (key === "right")
    return row.node.children.length === 0 || open.includes(own)
      ? null
      : { open: [...open, own], focus: row.node };
  if (row.node.children.length > 0 && open.includes(own))
    return { open: open.filter((k) => k !== own), focus: row.node };
  const parent = row.path.at(-1);
  if (parent === undefined) return null;
  return { open: open.filter((k) => k !== keyOf(parent)), focus: parent };
};

const indexOf = (all: ReadonlyArray<Row>, node: TreeNode) =>
  Math.max(
    0,
    all.findIndex((r) => r.kind === "node" && r.node === node),
  );

export interface TreeState {
  readonly nodes: ReadonlyArray<TreeNode>;
  readonly cursor: number;
  readonly open: ReadonlyArray<string>;
  /** The areas marked, by id; an area stands for its tasks. */
  readonly whole: ReadonlyArray<string>;
  /** The groups and tasks marked; one stands for its items. */
  readonly tasks: ReadonlyArray<string>;
}

export const rows = (state: TreeState): ReadonlyArray<Row> => [
  ...nodeRows(state.nodes, state.open),
  { kind: "continue" },
];

type Mark = "on" | "off" | "some";

const covered = (state: TreeState, row: NodeRow) =>
  [...row.path, row.node].some((node) =>
    node.kind === "area" ? state.whole.includes(node.id) : state.tasks.includes(node.id),
  );

const nodeMark = (state: TreeState, row: NodeRow): Mark => {
  if (isAction(row.node)) return "off";
  if (covered(state, row)) return "on";
  return descendants(row.node).some((d) => state.tasks.includes(d.id)) ? "some" : "off";
};

export const mark = (state: TreeState, row: Row): Mark =>
  row.kind === "node" ? nodeMark(state, row) : "off";

const without = <A>(list: ReadonlyArray<A>, drop: ReadonlyArray<A>) =>
  list.filter((item) => !drop.includes(item));

/** Space on a row: what it marks or clears, never one task twice. */
const toggle = (state: TreeState, row: Row): TreeState => {
  if (row.kind === "continue" || isAction(row.node)) return state;
  const { node, path } = row;
  const below = descendants(node).map((d) => d.id);
  if (node.kind === "area") {
    const on = nodeMark(state, { kind: "node", node, path: [] }) === "on";
    // A whole area covers its items: the single ones in it are not kept beside it.
    return on
      ? { ...state, whole: without(state.whole, [node.id]), tasks: without(state.tasks, below) }
      : { ...state, whole: [...state.whole, node.id], tasks: without(state.tasks, below) };
  }
  // Covered from above: the cover goes, and what it covered stays chosen except this node.
  const chain = [...path, node];
  const cover = chain.findIndex((n) =>
    n.kind === "area" ? state.whole.includes(n.id) : state.tasks.includes(n.id),
  );
  if (cover !== -1 && cover < chain.length - 1) {
    const top = chain[cover]!;
    const tasks = without(state.tasks, [top.id]);
    for (let i = cover; i < chain.length - 1; i++)
      tasks.push(...chain[i]!.children.filter((c) => c !== chain[i + 1]).map((c) => c.id));
    return {
      ...state,
      whole: top.kind === "area" ? without(state.whole, [top.id]) : state.whole,
      tasks,
    };
  }
  return state.tasks.includes(node.id)
    ? { ...state, tasks: without(state.tasks, [node.id]) }
    : { ...state, tasks: [...without(state.tasks, below), node.id] };
};

const label = (state: TreeState, row: Row) =>
  row.kind === "continue"
    ? "Continue"
    : nodeLabel(
        row,
        state.open.includes(keyOf(row.node)),
        isAction(row.node) ? null : mark(state, row),
      );

const HINT = "↑↓ move · space mark · → open · ← close · Enter choose, or Continue with marks";

/** The frame: a window of rows around the cursor, each one line at most `width` wide. */
export const frame = (state: TreeState, message: string, width = 80) =>
  windowed(
    message,
    rows(state).map((row) => label(state, row)),
    state.cursor,
    HINT,
    width,
  );

/** The row picked: an area (its id its name, "" for no area), a group or a task. */
export interface Picked {
  readonly kind: TreeNodeKind;
  readonly id: string;
}

/**
 * Start a task's tree: the scopes to mark. With one area it is open; with `expand`, the way down to
 * that node is open and the cursor on it.
 */
export const initialStart = (nodes: ReadonlyArray<TreeNode>, expand?: Picked): TreeState => {
  const shown = nodes.filter(
    (node) => node.kind !== "area" || node.id !== "" || node.children.length > 0,
  );
  const areas = shown.filter((node) => node.kind === "area");
  const path = expand === undefined ? null : pathTo(shown, expand);
  const open = path !== null ? path.map(keyOf) : areas.length === 1 ? [keyOf(areas[0]!)] : [];
  const state: TreeState = { nodes: shown, cursor: 0, open, whole: [], tasks: [] };
  const at = path?.at(-1);
  return at === undefined ? state : { ...state, cursor: indexOf(rows(state), at) };
};

/** The marked scopes in tree order; a marked node stands for its subtree, so nothing is twice. */
export const marked = (state: TreeState): ReadonlyArray<Picked> => {
  const out: Array<Picked> = [];
  const walk = (node: TreeNode) => {
    if (isAction(node)) return;
    if (node.kind === "area" ? state.whole.includes(node.id) : state.tasks.includes(node.id)) {
      out.push({ kind: node.kind, id: node.id });
      return;
    }
    node.children.forEach(walk);
  };
  state.nodes.forEach(walk);
  return out;
};

/**
 * A key, as the prompt hands it: what becomes of the state, or the scopes when done. Enter while
 * nothing is marked (or on an action row) picks that row alone, and Continue ends with the marked
 * scopes.
 */
export const startPress = (
  state: TreeState,
  key: string,
): { readonly state: TreeState } | { readonly done: ReadonlyArray<Picked> } => {
  const all = rows(state);
  const row = all[state.cursor];
  if (row === undefined) return { state };
  const move = (cursor: number) => ({ state: { ...state, cursor } });
  switch (key) {
    case "up":
      return move((state.cursor - 1 + all.length) % all.length);
    case "down":
    case "tab":
      return move((state.cursor + 1) % all.length);
    case "space":
      return { state: toggle(state, row) };
    case "right":
    case "left": {
      const changed = row.kind === "continue" ? null : openOrClose(state.open, row, key);
      if (changed === null) return { state };
      const next = { ...state, open: changed.open };
      return {
        state: key === "left" ? { ...next, cursor: indexOf(rows(next), changed.focus) } : next,
      };
    }
    case "enter":
    case "return":
      if (row.kind === "continue") return { done: marked(state) };
      if (isAction(row.node) || marked(state).length === 0)
        return { done: [{ kind: row.node.kind, id: row.node.id }] };
      if (row.node.kind === "area" || row.node.children.length > 0)
        return startPress(state, state.open.includes(keyOf(row.node)) ? "left" : "right");
      return { state: toggle(state, row) };
    default:
      return { state };
  }
};

/** Effect's custom prompt over a reducer: each key a next frame or the answer. */
const customPrompt = <S, A>(
  initial: S,
  draw: (state: S, width: number) => ReadonlyArray<string>,
  step: (state: S, key: string) => { readonly state: S } | { readonly done: A },
  message: string,
  said: (value: A) => string,
) => {
  type Action = Prompt.Action<S, A>;
  const Action = Data.taggedEnum<Action>();
  let drawn = 0;
  const erase = () => (drawn === 0 ? "" : `${"\x1b[2K\x1b[1A".repeat(drawn - 1)}\x1b[2K\x1b[G`);
  return Prompt.Custom<S, A>(initial, {
    render: (state, action) =>
      Effect.sync(() => {
        if (action._tag === "Submit") {
          drawn = 1;
          // Effect's own prompts end their answer line the same way; what follows starts fresh.
          return `✔ ${message} …  ${said(action.value)}\n`;
        }
        const lines = draw(
          state,
          (process.stdout.columns ?? 0) > 20 ? process.stdout.columns - 1 : 80,
        );
        drawn = lines.length;
        return `\x1b[?25l${lines.join("\n")}`;
      }),
    process: (input, state) =>
      Effect.sync((): Action => {
        const name =
          input.key.name === "" ? Option.getOrElse(input.input, () => "") : input.key.name;
        const next = step(state, name === " " ? "space" : name);
        return "done" in next
          ? Action.Submit({ value: next.done })
          : Action.NextFrame({ state: next.state });
      }),
    clear: () => Effect.sync(erase),
  });
};

/** The title of a picked row, for the answer line; the id when the tree does not hold it. */
const pickedTitle = (nodes: ReadonlyArray<TreeNode>, picked: Picked): string => {
  for (const node of nodes) {
    if (node.id === picked.id && node.kind === picked.kind) return node.title;
    const below = pickedTitle(node.children, picked);
    if (below !== picked.id) return below;
  }
  return picked.id;
};

/** Start a task's tree as a terminal prompt (`treePick`): the scopes, in tree order. */
export const treeStartPrompt = (message: string, nodes: ReadonlyArray<TreeNode>, expand?: Picked) =>
  customPrompt(
    initialStart(nodes, expand),
    (state, width) => frame(state, message, width),
    startPress,
    message,
    (picked) => (picked.length === 1 ? pickedTitle(nodes, picked[0]!) : `${picked.length} marked`),
  );
