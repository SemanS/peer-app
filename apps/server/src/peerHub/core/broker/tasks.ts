/**
 * `peer task`: an agent keeps its project's tasks for its person, as the person does in Peer's
 * Tasks: it lists them, adds one, changes one's title, area or status, or removes one. The Hub
 * checks the person's rights; the agent acts with them, never with more.
 *
 * @module peerHub/core/broker/tasks
 */
import * as Effect from "effect/Effect";

import { plain as fenced } from "../../peerText.ts";
import type { PeerBrokerHost, PeerBrokerPlugins } from "./host.ts";
import { hubWrite, refused, usage } from "./cliContract.ts";
import type { CommandArguments } from "./cli.ts";
import { TIMED_OUT, within } from "./sync.ts";

export const TASK_USAGE =
  'task [list] | task add "<title>" [--key <key>] [--area <area>] | task set <task> [--title "<title>"] [--area <area>] [--status open|review|done] | task remove <task>';
export const TASK_FLAGS = ["--key", "--area", "--title", "--status"];
export const TASK_HELP = {
  name: "task",
  usage: 'task [add "<title>" | set <task> | remove <task>]',
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

export async function taskCommand(
  host: PeerBrokerHost,
  session: { readonly workspace: string; readonly project: string },
  { plain, flag, args }: CommandArguments,
  facts: TaskFacts = async () => new Map(),
): Promise<string> {
  const [form = "list", ...rest] = plain;
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
      allowed();
      if (rest.length > 0) throw wrong();
      const all = tasks();
      if (all.length === 0)
        return `This project has no tasks. Add one with peer task add "<title>".`;
      const said = await facts(all);
      return [
        `Tasks of ${fenced(project, 80)} (${all.length}):`,
        ...all.map((t) => `  ${[line(t), ...(said.get(t.id) ?? [])].join(" · ")}`),
      ].join("\n");
    }
    case "add": {
      allowed("--key", "--area");
      const title = rest.join(" ").replace(/\s+/g, " ").trim();
      if (title === "" || title.length > 200)
        throw usage(
          "a task needs a title of at most 200 characters",
          'run peer task add "<title>".',
        );
      if (host.createTask === undefined) throw unsupported();
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
          }),
        "run peer task list to see whether it was added before repeating.",
      );
      const added = tasks().find((task) => !before.has(task.id));
      return added === undefined
        ? `Added the task ${fenced(title, 200)}; run peer task list to see it.`
        : `Added ${line(added)}.`;
    }
    case "set": {
      allowed("--title", "--area", "--status");
      if (rest.length !== 1) throw wrong();
      const task = find(tasks(), rest[0]);
      const title = flag("--title")?.trim();
      const area = flag("--area");
      const status = flag("--status");
      if (status !== undefined && !(STATUSES as ReadonlyArray<string>).includes(status))
        throw usage("a task's status is open, review or done", "repeat with one of them.");
      if (title === "" || (title?.length ?? 0) > 200)
        throw usage("a task's title has 1 to 200 characters", "repeat with another title.");
      if (title === undefined && area === undefined && status === undefined)
        throw usage(
          "say what changes: --title, --area or --status",
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
          }),
        "run peer task list to see whether it changed before repeating.",
      );
      const now = tasks().find((candidate) => candidate.id === task.id);
      return [
        `Changed ${line(now ?? task)}.`,
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
