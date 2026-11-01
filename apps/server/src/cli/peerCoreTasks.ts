/**
 * `peer core tasks`: a project's tasks as its tree, from a terminal, as the person with the Hub
 * session (no broker). Outcomes follow the peer-cli-contract. The tree the menus show is built here
 * from the Hub's tasks, and the prompt an editor starts on a scope with.
 *
 * @module cli/peerCoreTasks
 */
import {
  isExecutable,
  PEER_LOCAL_WORKSPACE,
  type PeerHubError,
  type PeerTask,
  taskKind,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as PeerHubClient from "../peerHub/core/hub/PeerHubClient.ts";
import * as PeerState from "../peerHub/core/state/PeerState.ts";
import { runCounts } from "../peerHub/core/work/runs.ts";
import { hubOutcome, type OneShotIo, outcome } from "./peerCoreIo.ts";
import * as Tree from "./peerCoreTree.ts";

export interface TaskBranch {
  readonly task: PeerTask;
  readonly children: ReadonlyArray<TaskBranch>;
}

/** Siblings by position, then created order, then id, as the Hub orders them. */
const sibling = (a: PeerTask, b: PeerTask) =>
  (a.position ?? 0) - (b.position ?? 0) ||
  a.createdAt.localeCompare(b.createdAt) ||
  a.id.localeCompare(b.id);

/**
 * A project's tasks as their tree: under their `parent`; a task whose parent is not among them
 * (an older Hub sends none) is a root.
 */
export const taskForest = (tasks: ReadonlyArray<PeerTask>): ReadonlyArray<TaskBranch> => {
  const ids = new Set(tasks.map((task) => task.id));
  const under = new Map<string | null, Array<PeerTask>>();
  for (const task of tasks) {
    const parent =
      task.parent !== undefined && ids.has(task.parent) && task.parent !== task.id
        ? task.parent
        : null;
    under.set(parent, [...(under.get(parent) ?? []), task]);
  }
  const seen = new Set<string>();
  const grow = (task: PeerTask): TaskBranch => {
    seen.add(task.id);
    return {
      task,
      children: (under.get(task.id) ?? [])
        .filter((child) => !seen.has(child.id))
        .toSorted(sibling)
        .map(grow),
    };
  };
  return (under.get(null) ?? []).toSorted(sibling).map(grow);
};

/**
 * The project as the menus' tree: its areas (the named ones, then the tasks without an area),
 * each with its roots and their items. Done items go, unless something under them is not done.
 */
export const projectTree = (input: {
  readonly areas: ReadonlyArray<string>;
  readonly tasks: ReadonlyArray<PeerTask>;
}): ReadonlyArray<Tree.TreeNode> => {
  const node = (branch: TaskBranch): ReadonlyArray<Tree.TreeNode> => {
    const { task } = branch;
    const children = branch.children.flatMap(node);
    if (task.status === "done" && children.length === 0) return [];
    return [
      {
        id: task.id,
        title: task.title,
        kind: taskKind(task),
        executable: isExecutable(task),
        status: task.status,
        ...(task.unsettled === true ? { unsettled: true } : {}),
        ...(task.progress === undefined ? {} : { progress: task.progress }),
        children,
      },
    ];
  };
  const roots = taskForest(input.tasks);
  const named = [
    ...new Set([
      ...input.areas,
      ...roots.flatMap(({ task }) => (task.area === undefined ? [] : [task.area])),
    ]),
  ];
  return [
    ...named.map((name) =>
      Tree.areaNode(name, roots.filter(({ task }) => task.area === name).flatMap(node)),
    ),
    Tree.areaNode(null, roots.filter(({ task }) => task.area === undefined).flatMap(node)),
  ];
};

/** What an agent is started on: one task, a group's open items, or an area's open tasks. */
export type WorkScope =
  | { readonly kind: "task"; readonly id: string; readonly title: string }
  | {
      readonly kind: "group";
      readonly id: string;
      readonly title: string;
      readonly project: string;
      readonly items: ReadonlyArray<{ readonly id: string; readonly title: string }>;
    }
  | {
      readonly kind: "area";
      readonly name: string | null;
      readonly project: string;
      readonly items: ReadonlyArray<{ readonly id: string; readonly title: string }>;
    };

/** A row of the tree as the scope an agent starts on. */
export const scopeOfNode = (project: string, node: Tree.TreeNode): WorkScope => {
  const items = Tree.openItems(node).map(({ id, title }) => ({ id, title }));
  if (node.kind === "area")
    return { kind: "area", name: node.id === "" ? null : node.id, project, items };
  return Tree.isExecutableNode(node)
    ? { kind: "task", id: node.id, title: node.title }
    : { kind: "group", id: node.id, title: node.title, project, items };
};

const SCOPE_ITEMS_LISTED = 30;

const onePrompt = (scope: WorkScope): string => {
  if (scope.kind === "task") return `Work on the Peer task "${scope.title}" (${scope.id}).`;
  const listed = scope.items
    .slice(0, SCOPE_ITEMS_LISTED)
    .map((item) => `- ${item.id} ${item.title}`);
  const more = scope.items.length - listed.length;
  const list = [...listed, ...(more > 0 ? [`and ${more} more`] : [])];
  if (scope.kind === "group")
    return [
      `Work on the Peer group "${scope.title}" (${scope.id}) in ${scope.project}: its open items, in order:`,
      ...list,
      "Mark each item done with peer task set <id> --status done as you finish it; peer ready says the group is done.",
    ].join("\n");
  return [
    scope.name === null
      ? `Work on the tasks of ${scope.project} without an area: its open tasks, in order:`
      : `Work on the area "${scope.name}" of ${scope.project}: its open tasks, in order:`,
    ...list,
    "Mark each task done with peer task set <id> --status done as you finish it.",
  ].join("\n");
};

/**
 * The first prompt of an agent started on a scope, or on several in order (each scope's own words
 * without its closing instruction, one closing line for the set). The server cannot import the
 * client runtime, so this is the twin of `scopePrompt` in `packages/client-runtime/src/peer/work.ts`;
 * `peerCoreTasks.test.ts` holds both to the same words.
 */
export const scopePrompt = (scope: WorkScope | ReadonlyArray<WorkScope>): string => {
  const scopes: ReadonlyArray<WorkScope> = "kind" in scope ? [scope] : scope;
  if (scopes.length === 1) return onePrompt(scopes[0]!);
  const project = scopes.find((s) => s.kind !== "task")?.project;
  return [
    project === undefined
      ? `Work on these ${scopes.length} Peer scopes, in this order:`
      : `Work on these ${scopes.length} Peer scopes in ${project}, in this order:`,
    ...scopes.flatMap((s, index) => {
      const lines = onePrompt(s).split("\n");
      if (lines.length > 1 && lines.at(-1)!.startsWith("Mark each ")) lines.pop();
      return ["", `${index + 1}. ${lines.join("\n")}`];
    }),
    "",
    "Mark each item done with peer task set <id> --status done as you finish it; peer ready says the scope is done.",
  ].join("\n");
};

interface ProjectRef {
  readonly workspace: string;
  readonly project: string;
}

export interface TasksInput {
  /** `--project <workspace/project>`. */
  readonly project?: string;
  readonly cwd: string;
  /** No broker runs, so peer-hub.json may be written (a binding by remote, finished invitations). */
  readonly canWrite: boolean;
}

const TASKS_NEXT = "check the project with peer core status, then repeat the command.";

/** `--project`, else the bound folder's project; undefined: every project of the person's. */
const projectOf = (
  input: { readonly project?: string; readonly cwd: string; readonly canWrite: boolean },
  io: OneShotIo,
) =>
  Effect.gen(function* () {
    const state = yield* PeerState.PeerState;
    if (input.project !== undefined) {
      const [workspace, project, ...rest] = input.project.trim().split("/");
      if (workspace === undefined || project === undefined || project === "" || rest.length > 0)
        return yield* outcome(
          "usage",
          `--project takes <workspace>/<project>, not ${input.project}`,
          "name the project as peer core status lists it.",
        );
      yield* state
        .project(workspace, project)
        .pipe(Effect.mapError((error) => outcome("refused", error.detail, TASKS_NEXT)));
      return { workspace, project } satisfies ProjectRef;
    }
    const place = yield* state.placeOf(input.cwd, { bindByRemote: input.canWrite });
    const notice = yield* state.pendingBindingNotice(input.cwd);
    if (notice !== null) yield* io.say(notice);
    return place === null || place.workspace === PEER_LOCAL_WORKSPACE
      ? undefined
      : ({ workspace: place.workspace, project: place.project } satisfies ProjectRef);
  });

/** Each workspace's tasks by project, as its Hub says now. */
const readWork = (slugs: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const client = yield* PeerHubClient.PeerHubClient;
    const { hubUrl, session } = yield* client.session.pipe(
      Effect.mapError((error) => hubOutcome(error, "tasks", TASKS_NEXT, true)),
    );
    const read = new Map<string, Readonly<Record<string, ReadonlyArray<PeerTask>>>>();
    for (const slug of slugs) {
      const work = yield* client.api
        .work(hubUrl, session, slug)
        .pipe(
          Effect.mapError((error: PeerHubError) => hubOutcome(error, "tasks", TASKS_NEXT, true)),
        );
      read.set(
        slug,
        Object.fromEntries(
          Object.entries(work.projects).map(([id, project]) => [id, project.tasks]),
        ),
      );
    }
    return read;
  });

const label = (task: PeerTask) => task.key ?? task.id;

/**
 * The lines of `peer core tasks`: the tree, two spaces a level, a parent's progress after its
 * title, `?` before an item a person has to settle, `· n runs` after a task agents have run on.
 * Done items go, unless something under them is not done.
 */
export const taskLines = (tasks: ReadonlyArray<PeerTask>): ReadonlyArray<string> => {
  const lines = (
    branch: TaskBranch,
    depth: number,
    area: string | undefined,
  ): ReadonlyArray<string> => {
    const { task } = branch;
    const below = branch.children.flatMap((child) => lines(child, depth + 1, area));
    if (task.status === "done" && below.length === 0) return [];
    const progress =
      task.progress === undefined ? "" : ` ${task.progress.done}/${task.progress.total}`;
    const counted =
      task.runs === undefined ? 0 : task.runs.running + task.runs.detached + task.runs.ended;
    const runs = counted === 0 ? "" : ` · ${counted} run${counted === 1 ? "" : "s"}`;
    return [
      `${"  ".repeat(depth)}${task.unsettled === true ? "? " : ""}${label(task)} · ${task.title}${progress} · ${task.status} · ${area ?? "no area"}${runs}`,
      ...below,
    ];
  };
  return taskForest(tasks).flatMap((root) => lines(root, 0, root.task.area));
};

/** `peer core tasks [--project <ws/id>]`. */
export const listTasks = (input: TasksInput, io: OneShotIo) =>
  Effect.gen(function* () {
    const state = yield* PeerState.PeerState;
    const { persisted } = yield* state.read;
    const chosen = yield* projectOf(input, io);
    const refs: ReadonlyArray<ProjectRef> =
      chosen !== undefined
        ? [chosen]
        : persisted.workspaces
            .filter((workspace) => workspace.slug !== PEER_LOCAL_WORKSPACE)
            .flatMap((workspace) =>
              (workspace.manifest?.projects ?? []).map((project) => ({
                workspace: workspace.slug,
                project: project.id,
              })),
            );
    if (refs.length === 0)
      return yield* outcome(
        "refused",
        "you are on no project yet",
        "join a workspace with peer core join <invitation link>, then repeat the command.",
      );
    const work = yield* readWork([...new Set(refs.map((ref) => ref.workspace))]);
    let listed = 0;
    for (const ref of refs) {
      // A Hub that predates runs counts none: this computer's own runs stand in for them.
      const here = runCounts(Object.values(persisted.runs ?? {}), ref.workspace, ref.project);
      const tasks = (work.get(ref.workspace)?.[ref.project] ?? []).map((task) => {
        const counts = here.get(task.id);
        return task.runs !== undefined || counts === undefined ? task : { ...task, runs: counts };
      });
      const shown = taskLines(tasks);
      if (refs.length > 1 && shown.length > 0)
        yield* io.say(`Project: ${ref.workspace}/${ref.project}`);
      for (const line of shown) yield* io.say(line);
      listed += shown.length;
    }
    if (listed === 0)
      yield* io.say(`Tasks: none in ${refs.map((r) => `${r.workspace}/${r.project}`).join(", ")}.`);
  });
