/**
 * The menu's `Start a task`: scopes marked in the project's tree (or one row picked alone), each
 * unsettled one settled, the ones nobody owns taken, then the agent to start on them in the
 * project here, its first prompt the set's `scopePrompt`.
 *
 * @module cli/peerCoreStart
 */
import * as Effect from "effect/Effect";

import type { OneShotIo } from "./peerCoreIo.ts";
import { type Editor, type MenuAsk, type MenuSteps, shortPath } from "./peerCoreMenu.ts";
import { scopeOfNode, scopePrompt } from "./peerCoreTasks.ts";
import * as Tree from "./peerCoreTree.ts";

/** The tree's own rows after the project's: a new task, another project's tasks. */
const NEW_TASK = "\0new";
const OTHER_PROJECT = "\0project";
const NO_PARENT = "\0none";
const NONE_NOW = "\0none-now";

interface StartProject {
  readonly workspace: string;
  readonly project: string;
}

const newTask = <R>(
  ask: MenuAsk<R>,
  steps: MenuSteps<R>,
  project: StartProject,
  nodes: ReadonlyArray<Tree.TreeNode>,
) =>
  Effect.gen(function* () {
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
    if (parent === null) return;
    const title = yield* ask.text(`What is the task? (in ${project.workspace}/${project.project})`);
    if (title === null || title.trim() === "") return;
    const take = yield* ask.confirm("Take it yourself?", true);
    yield* steps.startTask({
      ...project,
      title: title.trim(),
      take,
      ...(parent === NO_PARENT ? {} : { parent }),
    });
  });

/**
 * Marked scopes, or one row picked alone. An unsettled item is settled first (by its parts it
 * stays a group in a set; picked alone, the tree opens on it); a group or task nobody owns is
 * taken, someone else's is dropped with their name; areas are nobody's. Then `Which agent?`: an
 * editor connected here that Peer can start in the project's checkout, or none now.
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
    /** The editors connected here that Peer can start (`connected && launchable`). */
    readonly editors: ReadonlyArray<Editor>;
    /** The connected project here, where an editor starts. */
    readonly here:
      | { readonly root: string; readonly workspace: string; readonly project: string }
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
      if (picked === null || picked.length === 0) return undefined;
      if (picked[0]!.id === OTHER_PROJECT) {
        const next = yield* input.chooseProject;
        if (next === null) return undefined;
        project = next;
        continue;
      }
      if (picked[0]!.id === NEW_TASK) {
        yield* newTask(ask, steps, project, nodes);
        return undefined;
      }
      const alone = picked.length === 1;
      const chosen: Array<{ node: Tree.TreeNode; path: ReadonlyArray<Tree.TreeNode> }> = [];
      let reopen = false;
      for (const one of picked) {
        const path = Tree.pathTo(nodes, one);
        let node = path?.at(-1);
        if (path === null || node === undefined) continue;
        if (node.unsettled === true) {
          const how = yield* ask.choose<"one" | "parts">(
            `Run "${node.title}" as one task, or by its parts?`,
            [
              { title: "As one task", description: "An agent does it whole.", value: "one" },
              {
                title: "By its parts",
                description: alone
                  ? "Its items are the tasks; pick one of them or the whole."
                  : "Its items are the tasks; the agent works through them.",
                value: "parts",
              },
            ],
          );
          if (how === null) return undefined;
          yield* steps.settleTask(workspace, id, node.id, how === "one");
          if (how === "parts" && alone) {
            expand = one;
            reopen = true;
            break;
          }
          node = { ...node, unsettled: false, executable: how === "one" };
        }
        chosen.push({ node, path });
      }
      if (reopen) continue;
      const scopes: Array<Tree.TreeNode> = [];
      for (const { node, path } of chosen) {
        if (node.kind === "area") {
          scopes.push(node);
          continue;
        }
        const owner = path
          .toReversed()
          .find((n) => n.kind !== "area" && n.owner !== undefined)?.owner;
        if (owner !== undefined && owner.toLowerCase() !== input.me) {
          yield* io.say(
            alone
              ? `${node.title} is ${owner}'s: ask them to hand it over, or pick another.`
              : `${node.title} is ${owner}'s: ask them to hand it over; it is left out.`,
          );
          continue;
        }
        if (owner !== undefined) yield* io.say(`${node.title} is yours already.`);
        else {
          const took = yield* steps.takeTask(workspace, id, node.id).pipe(
            Effect.as(true),
            Effect.catch((error) =>
              io.say(`${String(error.message).replace(/^peer core: /, "")}`).pipe(Effect.as(false)),
            ),
          );
          if (!took) continue;
        }
        scopes.push(node);
      }
      if (scopes.length === 0) {
        if (alone && chosen.length === 1 && chosen[0]!.node.kind !== "area") continue;
        return undefined;
      }
      const launch = yield* chooseAgent(ask, steps, io, input, project, scopes);
      if (launch === undefined)
        for (const area of scopes.filter((n) => n.kind === "area"))
          yield* io.say(
            `${area.title}: ${Tree.openItems(area).length} open tasks. An area is nobody's to take; start an agent on it in the project.`,
          );
      return launch;
    }
  });

/** `Which agent?` over the editors here, starting in the project's checkout; `None now` last. */
const chooseAgent = <R>(
  ask: MenuAsk<R>,
  steps: MenuSteps<R>,
  io: OneShotIo,
  input: {
    readonly editors: ReadonlyArray<Editor>;
    readonly here:
      | { readonly root: string; readonly workspace: string; readonly project: string }
      | undefined;
  },
  project: StartProject,
  scopes: ReadonlyArray<Tree.TreeNode>,
) =>
  Effect.gen(function* () {
    if (input.editors.length === 0) {
      yield* io.say(
        "No connected editor can start here: connect one with peer core connect claude or peer core connect codex.",
      );
      return undefined;
    }
    const { here } = input;
    const inProject =
      here !== undefined &&
      here.workspace === project.workspace &&
      here.project === project.project;
    // The editor starts in the project's checkout: the folder here when it is one, else the one
    // this computer recorded for the project (bound, shared or cloned).
    const root = inProject
      ? here.root
      : yield* steps.checkoutOf(project.workspace, project.project);
    if (root === null)
      yield* io.say(
        `${project.workspace}/${project.project} has no checkout on this computer: clone it, bind one with peer core bind, or run peer core in its folder to start an agent on it.`,
      );
    const folder = root === null ? "" : shortPath(root, steps.home);
    const agent = yield* ask.choose<string>("Which agent?", [
      ...(root === null
        ? []
        : input.editors.map((editor) => ({
            title: editor.title,
            description: `Starts in ${folder} with Peer coordinating`,
            value: editor.id,
          }))),
      {
        title: "None now",
        description: "The task is yours; start an agent later.",
        value: NONE_NOW,
      },
    ]);
    if (agent === null || agent === NONE_NOW || root === null) return undefined;
    return {
      editor: agent,
      folder: root,
      prompt: scopePrompt(scopes.map((node) => scopeOfNode(project.project, node))),
    };
  });
