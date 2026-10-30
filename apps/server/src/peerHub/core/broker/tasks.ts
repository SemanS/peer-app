/**
 * `peer task`: an agent keeps its project's tasks for its person, as the person does in Peer's
 * Tasks: it lists them as their tree, adds one (under another, as a group), changes one's title,
 * area, status or place in the tree, or removes one. The Hub checks the person's rights; the agent
 * acts with them, never with more.
 *
 * @module peerHub/core/broker/tasks
 */
import { isExecutable } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { plain as fenced } from "../../peerText.ts";
import { runCounts, stateOf } from "../work/runs.ts";
import type { PeerBrokerHost, PeerBrokerPlugins } from "./host.ts";
import { hubWrite, refused, usage } from "./cliContract.ts";
import type { CommandArguments } from "./cli.ts";
import { TIMED_OUT, within } from "./sync.ts";

export const TASK_USAGE =
  'task [list] [--flat] | task show <task> | task add "<title>" [--key <key>] [--area <area>] [--under <task>] [--kind group|task] [--not-executable] | task set <task> [--title "<title>"] [--area <area>] [--status open|review|done] [--under <task>|none] [--executable yes|no] [--position <n>] | task remove <task>';
export const TASK_FLAGS = [
  "--key",
  "--area",
  "--title",
  "--status",
  "--under",
  "--kind",
  "--executable",
  "--position",
];
/** The flags of `peer task` that take no value. */
export const TASK_SWITCHES = ["--flat", "--not-executable"];
export const TASK_HELP = {
  name: "task",
  usage: 'task [show <task> | add "<title>" | set <task> | remove <task>]',
  summary:
    "list or change tasks for your person; --status is administrative, without handoff checks",
};
const STATUSES = ["open", "review", "done"] as const;
type Status = (typeof STATUSES)[number];

type Task = ReturnType<PeerBrokerHost["tasks"]>[number];

/** What plugins say of each task, by task id, in registry order. */
export type TaskFacts = (
  tasks: ReadonlyArray<Task>,
) => Promise<ReadonlyMap<string, ReadonlyArray<string>>>;

/** The active plugins' `taskFacts`, each given 100 ms; one that fails or is late adds nothing. */
export const pluginTaskFacts =
  (
    host: Pick<PeerBrokerHost, "run">,
    plugins: Pick<PeerBrokerPlugins, "active">,
    place: { readonly workspace: string; readonly project: string },
  ): TaskFacts =>
  async (tasks) => {
    const said = await Promise.all(
      plugins.active.map(async ({ contributions }) => {
        if (contributions.taskFacts === undefined) return new Map<string, string>();
        const facts = await within(
          host.run(
            contributions
              .taskFacts({ workspace: place.workspace, project: place.project }, tasks)
              .pipe(Effect.orElseSucceed((): ReadonlyMap<string, string> => new Map())),
          ),
          100,
        );
        return facts === TIMED_OUT ? new Map<string, string>() : facts;
      }),
    );
    const byTask = new Map<string, ReadonlyArray<string>>();
    for (const facts of said)
      for (const [id, fact] of facts)
        if (fact.trim() !== "") byTask.set(id, [...(byTask.get(id) ?? []), fenced(fact, 80)]);
    return byTask;
  };

const wrong = () => usage(`use peer ${TASK_USAGE}`, "run peer help for the commands.");

const line = (task: Task) =>
  `${task.key ? `${fenced(task.key, 40)} · ` : ""}${fenced(task.title, 200)} [${task.status ?? "open"}]${task.area ? ` (${fenced(task.area, 60)})` : ""} id:${task.id}`;

const progressOf = (task: Task) =>
  task.progress !== undefined && task.progress.total > 0
    ? ` ${task.progress.done}/${task.progress.total}`
    : "";

/** A row of the tree: `?` before an unsettled item, `3/8` after a parent's title, `group` noted. */
const treeLine = (task: Task) =>
  `${task.unsettled === true ? "? " : ""}${task.key ? `${fenced(task.key, 40)} · ` : ""}${fenced(task.title, 200)}${progressOf(task)} [${task.status ?? "open"}]${task.area ? ` (${fenced(task.area, 60)})` : ""}${task.kind === "group" ? " group" : ""} id:${task.id}`;

/** A task's items by parent; a task whose parent the list lacks is a root. */
function childrenByParent(tasks: ReadonlyArray<Task>): ReadonlyMap<string | undefined, Task[]> {
  const ids = new Set(tasks.map((task) => task.id));
  const byParent = new Map<string | undefined, Task[]>();
  for (const task of tasks) {
    const parent = task.parent !== undefined && ids.has(task.parent) ? task.parent : undefined;
    byParent.set(parent, [...(byParent.get(parent) ?? []), task]);
  }
  // Siblings by position, then the list's order (a stable sort keeps it).
  for (const siblings of byParent.values())
    siblings.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return byParent;
}

/** The tasks in tree order with their depth: parents before children, siblings by position. */
export function treeOrder(
  tasks: ReadonlyArray<Task>,
): ReadonlyArray<{ readonly task: Task; readonly depth: number }> {
  const byParent = childrenByParent(tasks);
  const out: Array<{ task: Task; depth: number }> = [];
  const seen = new Set<string>();
  const walk = (parent: string | undefined, depth: number) => {
    for (const task of byParent.get(parent) ?? []) {
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      out.push({ task, depth });
      walk(task.id, depth + 1);
    }
  };
  walk(undefined, 0);
  // A cycle the Hub should never hold leaves its members unreached; list them as roots.
  for (const task of tasks) if (!seen.has(task.id)) out.push({ task, depth: 0 });
  return out;
}

/** Every task under `id`, at any depth. */
function descendantsOf(tasks: ReadonlyArray<Task>, id: string): ReadonlyArray<Task> {
  const byParent = childrenByParent(tasks);
  const out: Task[] = [];
  const seen = new Set([id]);
  const walk = (parent: string) => {
    for (const task of byParent.get(parent) ?? []) {
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      out.push(task);
      walk(task.id);
    }
  };
  walk(id);
  return out;
}

/**
 * The session's task as `peer status` names it: a task by its name; a group (or any item that is
 * not run as one) also by its progress and its open items.
 */
export function sessionTaskName(tasks: ReadonlyArray<Task>, task: Task, name: string): string {
  if (task.kind !== "group" && isExecutable(task)) return name;
  const open = descendantsOf(tasks, task.id).filter(
    (item) => isExecutable(item) && (item.status ?? "open") === "open",
  ).length;
  const done =
    task.progress !== undefined && task.progress.total > 0
      ? `${task.progress.done}/${task.progress.total} done, `
      : "";
  return `${name} (${task.kind === "group" ? "group" : "items"}: ${done}${open} open item${open === 1 ? "" : "s"})`;
}

/** The plain words of `peer task`'s arguments: neither flags, their values nor switches. */
function plainOf(args: ReadonlyArray<string>): ReadonlyArray<string> {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (TASK_SWITCHES.includes(arg)) continue;
    if (arg.startsWith("--")) i++;
    else out.push(arg);
  }
  return out;
}

/** The task a word names: its id, its key (in any case) or its whole title. */
function find(tasks: ReadonlyArray<Task>, word: string | undefined): Task {
  const wanted = word?.trim().toLowerCase() ?? "";
  if (wanted === "") throw wrong();
  const byId = tasks.find((task) => task.id === word!.trim());
  const byKey = tasks.find((task) => task.key?.toLowerCase() === wanted);
  const titled = tasks.filter((task) => task.title.trim().toLowerCase() === wanted);
  const found = byId ?? byKey ?? (titled.length === 1 ? titled[0] : undefined);
  if (found !== undefined) return found;
  throw refused(
    titled.length === 0
      ? `this project has no task ${fenced(word!, 80)}`
      : `${titled.length} tasks are titled ${fenced(word!, 80)}`,
    "run peer task list and name the task by its key or id.",
  );
}

/** `--under <task>`: the parent's id, or `""` for `none` when `clears` (a root). */
function parentOf(tasks: ReadonlyArray<Task>, word: string | undefined, clears: boolean) {
  if (word === undefined) return undefined;
  if (clears && word.trim().toLowerCase() === "none") return "";
  return find(tasks, word).id;
}

const KINDS = ["group", "task"] as const;
const MAX_POSITION = 1_000_000;

export async function taskCommand(
  host: PeerBrokerHost,
  session: { readonly workspace: string; readonly project: string },
  { flag, args }: CommandArguments,
  facts: TaskFacts = async () => new Map(),
): Promise<string> {
  const [form = "list", ...rest] = plainOf(args);
  const { workspace, project } = session;
  const tasks = () => host.tasks(workspace, project);
  const flags = new Set(args.filter((arg) => arg.startsWith("--")));
  const allowed = (...names: ReadonlyArray<string>) => {
    if ([...flags].some((name) => !names.includes(name))) throw wrong();
  };
  const unsupported = () =>
    refused("this Peer cannot change tasks for agents", "ask your person to update Peer.");
  switch (form) {
    case "list": {
      allowed("--flat");
      if (rest.length > 0) throw wrong();
      const all = tasks();
      if (all.length === 0)
        return `This project has no tasks. Add one with peer task add "<title>".`;
      const said = await facts(all);
      const counts = runCounts(host.runs?.all() ?? [], workspace, project);
      const runsOf = (id: string) => {
        const c = counts.get(id);
        if (c === undefined) return [];
        const parts = (["running", "detached", "ended"] as const).flatMap((state) =>
          c[state] === 0 ? [] : [`${c[state]} ${state}`],
        );
        return [`runs: ${parts.join(", ")}`];
      };
      const rows = flags.has("--flat")
        ? all.map((task) => ({ task, depth: 0, text: line(task) }))
        : treeOrder(all).map(({ task, depth }) => ({ task, depth, text: treeLine(task) }));
      return [
        `Tasks of ${fenced(project, 80)} (${all.length}):`,
        ...rows.map(
          ({ task, depth, text }) =>
            `${"  ".repeat(depth + 1)}${[text, ...(said.get(task.id) ?? []), ...runsOf(task.id)].join(" · ")}`,
        ),
      ].join("\n");
    }
    case "show": {
      allowed();
      if (rest.length !== 1) throw wrong();
      const task = find(tasks(), rest[0]);
      const runs = host.runs?.ofTask(workspace, project, task.id) ?? [];
      return [
        treeLine(task),
        ...(runs.length === 0
          ? ["No run is on this task on this computer yet."]
          : [
              "Runs:",
              ...runs.map((run) => `  ${run.id} · ${run.agent} · ${run.runtime} · ${stateOf(run)}`),
            ]),
      ].join("\n");
    }
    case "add": {
      allowed("--key", "--area", "--under", "--kind", "--not-executable");
      const title = rest.join(" ").replace(/\s+/g, " ").trim();
      if (title === "" || title.length > 200)
        throw usage(
          "a task needs a title of at most 200 characters",
          'run peer task add "<title>".',
        );
      const kind = flag("--kind");
      if (kind !== undefined && !(KINDS as ReadonlyArray<string>).includes(kind))
        throw usage("a task's kind is group or task", "repeat with --kind group or --kind task.");
      if (host.createTask === undefined) throw unsupported();
      const parent = parentOf(tasks(), flag("--under"), false);
      const before = new Set(tasks().map((task) => task.id));
      const key = flag("--key");
      const area = flag("--area");
      await hubWrite(
        "task add",
        () =>
          host.createTask!(workspace, project, {
            title,
            ...(key === undefined ? {} : { key }),
            ...(area === undefined ? {} : { area }),
            ...(parent === undefined ? {} : { parent }),
            ...(kind === undefined ? {} : { kind: kind as (typeof KINDS)[number] }),
            ...(flags.has("--not-executable") ? { executable: false } : {}),
          }),
        "run peer task list to see whether it was added before repeating.",
      );
      const added = tasks().find((task) => !before.has(task.id));
      return added === undefined
        ? `Added the task ${fenced(title, 200)}; run peer task list to see it.`
        : `Added ${treeLine(added)}${parent === undefined ? "" : ` under ${line(tasks().find((t) => t.id === parent) ?? { id: parent, title: parent })}`}.`;
    }
    case "set": {
      allowed("--title", "--area", "--status", "--under", "--executable", "--position");
      if (rest.length !== 1) throw wrong();
      const all = tasks();
      const task = find(all, rest[0]);
      const title = flag("--title")?.trim();
      const area = flag("--area");
      const status = flag("--status");
      const executableWord = flag("--executable");
      const positionWord = flag("--position");
      if (status !== undefined && !(STATUSES as ReadonlyArray<string>).includes(status))
        throw usage("a task's status is open, review or done", "repeat with one of them.");
      if (title === "" || (title?.length ?? 0) > 200)
        throw usage("a task's title has 1 to 200 characters", "repeat with another title.");
      if (executableWord !== undefined && executableWord !== "yes" && executableWord !== "no")
        throw usage(
          "--executable is yes or no",
          "repeat with --executable yes or --executable no.",
        );
      if (
        positionWord !== undefined &&
        (!/^\d+$/.test(positionWord) || Number(positionWord) > MAX_POSITION)
      )
        throw usage(
          `a position is a whole number from 0 to ${MAX_POSITION}`,
          "repeat with --position 0 for the first place.",
        );
      const parent = parentOf(all, flag("--under"), true);
      if (parent === task.id || descendantsOf(all, task.id).some((item) => item.id === parent))
        throw refused(
          `${fenced(task.title, 200)} cannot sit under itself or one of its own items`,
          "name another task with --under, or --under none for a root.",
        );
      const executable = executableWord === undefined ? undefined : executableWord === "yes";
      const position = positionWord === undefined ? undefined : Number(positionWord);
      if ([title, area, status, parent, executable, position].every((value) => value === undefined))
        throw usage(
          "say what changes: --title, --area, --status, --under, --executable or --position",
          `run peer task set ${task.key ?? task.id} --status done.`,
        );
      if (host.updateTask === undefined) throw unsupported();
      await hubWrite(
        "task set",
        () =>
          host.updateTask!(workspace, project, task.id, {
            ...(title === undefined ? {} : { title }),
            ...(area === undefined ? {} : { area }),
            ...(status === undefined ? {} : { status: status as Status }),
            ...(parent === undefined ? {} : { parent }),
            ...(executable === undefined ? {} : { executable }),
            ...(position === undefined ? {} : { position }),
          }),
        "run peer task list to see whether it changed before repeating.",
      );
      const now = tasks().find((candidate) => candidate.id === task.id);
      return [
        `Changed ${line(now ?? task)}.`,
        ...(executable === undefined
          ? []
          : [
              executable
                ? "This settles it: an agent may run it as one task."
                : "This settles it: it is not run as one task; its items are.",
            ]),
        ...(status === "review" || status === "done"
          ? [
              "This administrative status change did not verify the agent's handoff. Use peer review or peer done for guarded handoff checks.",
            ]
          : []),
      ].join("\n");
    }
    case "remove": {
      allowed();
      if (rest.length !== 1) throw wrong();
      const task = find(tasks(), rest[0]);
      if (host.deleteTask === undefined) throw unsupported();
      await hubWrite(
        "task remove",
        () => host.deleteTask!(workspace, project, task.id),
        "run peer task list to see whether it is gone before repeating.",
      );
      return `Removed ${line(task)}. To have it back, add it again.`;
    }
    default:
      throw wrong();
  }
}
