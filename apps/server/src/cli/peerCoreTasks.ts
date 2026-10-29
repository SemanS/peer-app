/**
 * `peer core tasks` and `peer core take`: a person's tasks as the project's tree and taking one
 * nobody owns (a group too), from a terminal, as the person with the Hub session (no broker). The
 * task an invitation named is listed first until it is done. Outcomes follow the
 * peer-cli-contract. The tree the menus show is built here from the Hub's tasks, and the prompt an
 * editor starts on a scope with.
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
import * as Option from "effect/Option";

import * as PeerHubClient from "../peerHub/core/hub/PeerHubClient.ts";
import * as PeerState from "../peerHub/core/state/PeerState.ts";
import { hubOutcome, type OneShotIo, outcome } from "./peerCoreIo.ts";
import type { Editor, MenuAsk, MenuSteps } from "./peerCoreMenu.ts";
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

/** Who owns a task: its own row, else the nearest ancestor's. */
const ownerThrough = (
  owners: Readonly<Record<string, string>> | undefined,
  task: PeerTask,
  inherited: string | undefined,
) => owners?.[task.id] ?? inherited;

/**
 * The project as the menus' tree: its areas (the named ones, then the tasks without an area),
 * each with its roots and their items. Done items go, unless something under them is not done.
 */
export const projectTree = (input: {
  readonly areas: ReadonlyArray<string>;
  readonly tasks: ReadonlyArray<PeerTask>;
  /** Task id → owner, by the task's own row. */
  readonly owners?: Readonly<Record<string, string>>;
  readonly areaOwners?: Readonly<Record<string, string>>;
  readonly imported?: ReadonlySet<string>;
}): ReadonlyArray<Tree.TreeNode> => {
  const node = (branch: TaskBranch): ReadonlyArray<Tree.TreeNode> => {
    const { task } = branch;
    const children = branch.children.flatMap(node);
    if (task.status === "done" && children.length === 0) return [];
    const owner = input.owners?.[task.id];
    return [
      {
        id: task.id,
        title: task.title,
        kind: taskKind(task),
        executable: isExecutable(task),
        status: task.status,
        ...(task.unsettled === true ? { unsettled: true } : {}),
        ...(task.progress === undefined ? {} : { progress: task.progress }),
        ...(owner === undefined ? {} : { owner }),
        ...(input.imported?.has(task.id) === true || task.source?.system === "openspec"
          ? { openspec: true }
          : {}),
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
      Tree.areaNode(
        name,
        roots.filter(({ task }) => task.area === name).flatMap(node),
        input.areaOwners?.[name],
      ),
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

/**
 * The first prompt of an agent started on a scope. The server cannot import the client runtime,
 * so this is the twin of `scopePrompt` in `packages/client-runtime/src/peer/work.ts`;
 * `peerCoreTasks.test.ts` holds both to the same words.
 */
export const scopePrompt = (scope: WorkScope): string => {
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
      "Mark each item done with peer task set <id> --status done as you finish it; peer done on the group finishes the group itself.",
    ].join("\n");
  return [
    scope.name === null
      ? `Work on the tasks of ${scope.project} without an area: its open tasks, in order:`
      : `Work on the area "${scope.name}" of ${scope.project}: its open tasks, in order:`,
    ...list,
    "Mark each task done with peer task set <id> --status done as you finish it.",
  ].join("\n");
};

export type TaskFilter = "all" | "open" | "mine";

interface ProjectRef {
  readonly workspace: string;
  readonly project: string;
}

export interface TasksInput {
  /** `--project <workspace/project>`. */
  readonly project?: string;
  readonly filter: TaskFilter;
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

/** Each workspace's tasks and their owners, as its Hub says now. */
const readWork = (slugs: ReadonlyArray<string>, command: string) =>
  Effect.gen(function* () {
    const client = yield* PeerHubClient.PeerHubClient;
    const { hubUrl, session } = yield* client.session.pipe(
      Effect.mapError((error) => hubOutcome(error, command, TASKS_NEXT, true)),
    );
    const read = new Map<
      string,
      {
        readonly projects: Readonly<Record<string, ReadonlyArray<PeerTask>>>;
        /** Task id → owner's address per project; undefined: the Hub does not say (no ownership). */
        readonly owners: Readonly<Record<string, Readonly<Record<string, string>>>> | undefined;
      }
    >();
    for (const slug of slugs) {
      const work = yield* client.api
        .work(hubUrl, session, slug)
        .pipe(
          Effect.mapError((error: PeerHubError) => hubOutcome(error, command, TASKS_NEXT, true)),
        );
      const view = yield* client.api.taskOwners(hubUrl, session, slug).pipe(Effect.option);
      read.set(slug, {
        projects: Object.fromEntries(
          Object.entries(work.projects).map(([id, project]) => [id, project.tasks]),
        ),
        owners: Option.isNone(view)
          ? undefined
          : Object.fromEntries(
              Object.entries(view.value.projects).map(([id, project]) => [
                id,
                Object.fromEntries(
                  Object.entries(project.tasks).map(([task, owner]) => [task, owner.owner]),
                ),
              ]),
            ),
      });
    }
    return read;
  });

const label = (task: PeerTask) => task.key ?? task.id;

/**
 * The lines of `peer core tasks`: the tree, two spaces a level, a parent's progress after its
 * title, `?` before an item a person has to settle. `--open`/`--mine` keep the executable items
 * they match and the items above them; done items go.
 */
export const taskLines = (input: {
  readonly tasks: ReadonlyArray<PeerTask>;
  /** Task id → owner by its own row; undefined: the Hub does not say. */
  readonly owners: Readonly<Record<string, string>> | undefined;
  readonly filter: TaskFilter;
  readonly email: string | null;
  /** Roots holding such a task are listed first (the invitation's). */
  readonly first?: (task: PeerTask) => boolean;
}): ReadonlyArray<string> => {
  const { owners, filter, email } = input;
  const matches = (owner: string | undefined) =>
    filter === "open"
      ? owners !== undefined && owner === undefined
      : filter === "mine"
        ? email !== null && owner === email
        : true;
  const lines = (
    branch: TaskBranch,
    depth: number,
    area: string | undefined,
    inherited: string | undefined,
  ): ReadonlyArray<string> => {
    const { task } = branch;
    const owner = ownerThrough(owners, task, inherited);
    const below = branch.children.flatMap((child) => lines(child, depth + 1, area, owner));
    const self =
      task.status !== "done" && (filter === "all" || (isExecutable(task) && matches(owner)));
    if (!self && below.length === 0) return [];
    const progress =
      task.progress === undefined ? "" : ` ${task.progress.done}/${task.progress.total}`;
    const who = owners === undefined ? "owner unknown" : (owner ?? "nobody");
    return [
      `${"  ".repeat(depth)}${task.unsettled === true ? "? " : ""}${label(task)} · ${task.title}${progress} · ${task.status} · ${area ?? "no area"} · ${who}`,
      ...below,
    ];
  };
  const holds = (branch: TaskBranch): boolean =>
    input.first?.(branch.task) === true || branch.children.some(holds);
  return taskForest(input.tasks)
    .toSorted((a, b) => Number(holds(b)) - Number(holds(a)))
    .flatMap((root) => lines(root, 0, root.task.area, undefined));
};

/** `peer core tasks [--project <ws/id>] [--open|--mine]`. */
export const listTasks = (input: TasksInput, io: OneShotIo) =>
  Effect.gen(function* () {
    const state = yield* PeerState.PeerState;
    const { persisted } = yield* state.read;
    const email = persisted.email?.toLowerCase() ?? null;
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
    const work = yield* readWork([...new Set(refs.map((ref) => ref.workspace))], "tasks");
    const invited = persisted.invitedTasks ?? [];
    const finished: Array<{ readonly workspace: string; readonly task: string }> = [];
    let listed = 0;
    for (const ref of refs) {
      const read = work.get(ref.workspace);
      const tasks = read?.projects[ref.project] ?? [];
      const owners = read?.owners?.[ref.project];
      for (const entry of invited)
        if (entry.workspace === ref.workspace && (entry.project ?? ref.project) === ref.project) {
          const task = tasks.find((t) => t.id === entry.task);
          if (task?.status === "done") finished.push(entry);
        }
      const isInvited = (task: PeerTask) =>
        invited.some(
          (entry) =>
            entry.workspace === ref.workspace &&
            (entry.project ?? ref.project) === ref.project &&
            entry.task === task.id,
        );
      const shown = taskLines({ tasks, owners, filter: input.filter, email, first: isInvited });
      if (refs.length > 1 && shown.length > 0)
        yield* io.say(`Project: ${ref.workspace}/${ref.project}`);
      for (const line of shown) yield* io.say(line);
      listed += shown.length;
    }
    if (listed === 0)
      yield* io.say(
        `Tasks: none${input.filter === "open" ? " nobody owns" : input.filter === "mine" ? " of yours" : ""} in ${refs.map((r) => `${r.workspace}/${r.project}`).join(", ")}.`,
      );
    if (input.canWrite && finished.length > 0)
      yield* state
        .updatePersisted((p) => ({
          ...p,
          invitedTasks: (p.invitedTasks ?? []).filter(
            (entry) =>
              !finished.some(
                (done) => done.workspace === entry.workspace && done.task === entry.task,
              ),
          ),
        }))
        .pipe(Effect.ignore);
  });

export interface TakeInput {
  readonly task: string;
  readonly project?: string;
  readonly cwd: string;
  readonly canWrite: boolean;
  /** `--as-one` / `--as-parts`: settles whether it runs as one task or by its parts. */
  readonly settle?: "one" | "parts";
}

/**
 * `peer core take <task> [--project <ws/id>] [--as-one|--as-parts]`: the person becomes the owner
 * of a task or group nobody owns, settling it first when a flag says how it runs.
 */
export const takeTask = (input: TakeInput, io: OneShotIo) =>
  Effect.gen(function* () {
    const state = yield* PeerState.PeerState;
    const client = yield* PeerHubClient.PeerHubClient;
    const { persisted } = yield* state.read;
    const wanted = input.task.trim();
    if (wanted === "")
      return yield* outcome("usage", "take needs a task", "name it as peer core tasks lists it.");
    const email = persisted.email?.toLowerCase() ?? null;
    if (email === null)
      return yield* outcome(
        "refused",
        "nobody is signed in here",
        "sign in with peer core login <email>, then repeat the command.",
      );
    const chosen = yield* projectOf(input, io);
    const invitedProject = persisted.invitedTasks?.find(
      (entry) => entry.task === wanted && entry.project !== undefined,
    );
    const candidates: ReadonlyArray<ProjectRef> =
      chosen !== undefined
        ? [chosen]
        : invitedProject?.project !== undefined
          ? [{ workspace: invitedProject.workspace, project: invitedProject.project }]
          : persisted.workspaces
              .filter((workspace) => workspace.slug !== PEER_LOCAL_WORKSPACE)
              .flatMap((workspace) =>
                (workspace.manifest?.projects ?? []).map((project) => ({
                  workspace: workspace.slug,
                  project: project.id,
                })),
              );
    const work = yield* readWork([...new Set(candidates.map((ref) => ref.workspace))], "take");
    const found = candidates.flatMap((ref) => {
      const task = (work.get(ref.workspace)?.projects[ref.project] ?? []).find(
        (t) => t.id === wanted || t.key === wanted,
      );
      return task === undefined ? [] : [{ ...ref, task }];
    });
    if (found.length === 0)
      return yield* outcome(
        "refused",
        `no task ${wanted} in ${candidates.map((r) => `${r.workspace}/${r.project}`).join(", ") || "your projects"}`,
        "find it with peer core tasks, then repeat the command.",
      );
    if (found.length > 1)
      return yield* outcome(
        "usage",
        `${wanted} is a task of ${found.map((f) => `${f.workspace}/${f.project}`).join(" and ")}`,
        "choose one with --project <workspace>/<project>.",
      );
    const { workspace, project, task } = found[0]!;
    const where = `${workspace}/${project}`;
    if (task.status === "done")
      return yield* outcome(
        "refused",
        `${label(task)} is done`,
        "take a task that is not done; peer core tasks lists them.",
      );
    // An item without an owner of its own is owned through the nearest owned item above it.
    const tasks = work.get(workspace)?.projects[project] ?? [];
    const rows = work.get(workspace)?.owners?.[project];
    let owner: string | undefined;
    for (
      let at: PeerTask | undefined = task, hops = 0;
      at !== undefined && owner === undefined && hops < 16;
      at = tasks.find((t) => t.id === at!.parent), hops++
    )
      owner = rows?.[at.id];
    const named = (address: string) => `${state.nameOf(workspace, address)} (${address})`;
    const handOver = `ask them to hand it over, or a lead of ${where} to name you.`;
    if (owner !== undefined && owner !== email)
      return yield* outcome("refused", `${label(task)} is owned by ${named(owner)}`, handOver);
    const { hubUrl, session } = yield* client.session.pipe(
      Effect.mapError((error) => hubOutcome(error, "take", TASKS_NEXT, true)),
    );
    if (input.settle !== undefined) {
      const executable = input.settle === "one";
      if (task.unsettled === true || isExecutable(task) !== executable)
        yield* client.api
          .updateTask(hubUrl, session, workspace, project, task.id, {
            executable,
            unsettled: false,
          })
          .pipe(Effect.mapError((error) => hubOutcome(error, "take", TASKS_NEXT, false)));
      yield* io.say(
        `${label(task)} · ${task.title} runs ${executable ? "as one task" : "by its parts"} now.`,
      );
    } else if (task.unsettled === true)
      yield* io.say(
        `${label(task)} is not settled yet: run it as one task with --as-one, or by its parts with --as-parts.`,
      );
    if (owner === email) {
      yield* io.say(`You own ${label(task)} · ${task.title} already (${where}).`);
      return;
    }
    const answer = yield* client.api
      .takeTask(hubUrl, session, workspace, project, task.id, { owner: email })
      .pipe(
        Effect.mapError((error) =>
          hubOutcome(
            error,
            "take",
            error.refused === true
              ? `ask a lead of ${where} to name you the owner.`
              : "run peer core tasks to see who owns it, and repeat the command only if it is still nobody.",
            false,
          ),
        ),
      );
    if ("ownedBy" in answer)
      return yield* outcome(
        "refused",
        `${label(task)} is owned by ${named(answer.ownedBy)}`,
        handOver,
      );
    // Someone else's take reached the Hub first.
    if (answer.owner !== null && answer.owner.owner !== email)
      return yield* outcome(
        "refused",
        `${label(task)} is owned by ${named(answer.owner.owner)}`,
        handOver,
      );
    yield* io.say(`You own ${label(task)} · ${task.title} now (${where}).`);
  });

/** The tree's own rows after the project's: a new task, another project's tasks. */
const NEW_TASK = "\0new";
const OTHER_PROJECT = "\0project";
const NO_PARENT = "\0none";

interface StartProject {
  readonly workspace: string;
  readonly project: string;
}

/**
 * The menu's `Start a task`: the project's tree, any row picked. An unsettled item is settled
 * first (by its parts, the tree opens on it); a group or task nobody owns is taken; areas are
 * nobody's. The editor to open on it, with its first prompt, when one connected here can.
 */
export const startOnTree = <R>(
  ask: MenuAsk<R>,
  steps: MenuSteps<R>,
  io: OneShotIo,
  input: {
    readonly project: StartProject;
    readonly chooseProject: Effect.Effect<StartProject | null, never, R>;
    /** The person is on more projects than this one. */
    readonly others: boolean;
    readonly me: string | undefined;
    /** The connected project here, and the editor that can start in it. */
    readonly editor:
      | {
          readonly editor: Editor | undefined;
          readonly here: {
            readonly root: string;
            readonly workspace: string;
            readonly project: string;
          };
        }
      | undefined;
  },
) =>
  Effect.gen(function* () {
    let project = input.project;
    let expand: Tree.Picked | undefined;
    for (;;) {
      const { workspace, project: id } = project;
      const nodes = yield* steps.scope(workspace, id);
      const picked = yield* ask.treePick(
        `Which task? (${workspace}/${id})`,
        [
          ...nodes,
          { id: NEW_TASK, title: "New task…", kind: "task", children: [] },
          ...(input.others
            ? [
                {
                  id: OTHER_PROJECT,
                  title: "Tasks of another project…",
                  kind: "task" as const,
                  children: [],
                },
              ]
            : []),
        ],
        expand,
      );
      expand = undefined;
      if (picked === null) return undefined;
      if (picked.id === OTHER_PROJECT) {
        const next = yield* input.chooseProject;
        if (next === null) return undefined;
        project = next;
        continue;
      }
      if (picked.id === NEW_TASK) {
        const flat = (node: Tree.TreeNode): ReadonlyArray<{ title: string; value: string }> => {
          const below = node.children.flatMap(flat);
          return node.kind === "area" ? below : [{ title: node.title, value: node.id }, ...below];
        };
        const parents = nodes.flatMap(flat);
        const parent =
          parents.length === 0
            ? NO_PARENT
            : yield* ask.choose<string>("Under which item?", [
                { title: "(none)", value: NO_PARENT },
                ...parents,
              ]);
        if (parent === null) return undefined;
        const title = yield* ask.text(`What is the task? (in ${workspace}/${id})`);
        if (title === null || title.trim() === "") return undefined;
        const take = yield* ask.confirm("Take it yourself?", true);
        yield* steps.startTask({
          ...project,
          title: title.trim(),
          take,
          ...(parent === NO_PARENT ? {} : { parent }),
        });
        return undefined;
      }
      const path = Tree.pathTo(nodes, picked);
      let node = path?.at(-1);
      if (path === null || node === undefined) return undefined;
      if (node.unsettled === true) {
        const how = yield* ask.choose<"one" | "parts">(
          `Run "${node.title}" as one task, or by its parts?`,
          [
            { title: "As one task", description: "An agent does it whole.", value: "one" },
            {
              title: "By its parts",
              description: "Its items are the tasks; pick one of them or the whole.",
              value: "parts",
            },
          ],
        );
        if (how === null) return undefined;
        yield* steps.settleTask(workspace, id, node.id, how === "one");
        if (how === "parts") {
          expand = picked;
          continue;
        }
        node = { ...node, unsettled: false, executable: true };
      }
      if (node.kind !== "area") {
        const owner = path
          .toReversed()
          .find((n) => n.kind !== "area" && n.owner !== undefined)?.owner;
        if (owner === undefined) yield* steps.takeTask(workspace, id, node.id);
        else if (owner.toLowerCase() === input.me) yield* io.say(`${node.title} is yours already.`);
        else {
          yield* io.say(`${node.title} is ${owner}'s: ask them to hand it over, or pick another.`);
          continue;
        }
      }
      const at = input.editor;
      if (
        at?.editor !== undefined &&
        at.here.workspace === workspace &&
        at.here.project === id &&
        (yield* ask.confirm(`Open ${at.editor.title} on it now?`, true))
      )
        return {
          editor: at.editor.id,
          folder: at.here.root,
          prompt: scopePrompt(scopeOfNode(id, node)),
        };
      if (node.kind === "area")
        yield* io.say(
          `${node.title}: ${Tree.openItems(node).length} open tasks. An area is nobody's to take; start an agent on it in the project.`,
        );
      return undefined;
    }
  });
