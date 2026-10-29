/**
 * One model for every specification Peer imports (OpenSpec today; a PRD or an epic later): a tree
 * of `WorkItem`s, synchronised with a project's tasks. A repeated import creates nothing twice,
 * changes a field only where the source moved and Peer still holds what the last import wrote, says
 * an edit made on both sides and keeps Peer's, and never deletes. What the last import wrote is the
 * caller's record (`SyncRecord`), handed in and saved back through `save`.
 *
 * @module peerHub/core/work/workItems
 */
import {
  isExecutable,
  taskKind,
  type PeerHubUpdateTaskInput,
  type PeerTask,
  type PeerTaskKind,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as PeerHubClient from "../hub/PeerHubClient.ts";
import * as PeerWork from "./PeerWork.ts";

export interface WorkItem {
  /** The source reference, unique within the import: `add-x`, `add-x#1.2`. */
  readonly ref: string;
  /** Another item's ref; null for a root. */
  readonly parent: string | null;
  /** A step never reaches the Hub: `foldSteps` makes it a line of its item's description. */
  readonly kind: "group" | "task" | "step";
  readonly title: string;
  readonly executable: boolean;
  readonly unsettled: boolean;
  /** Among its siblings, from 0. */
  readonly position: number;
  /** The source says it is finished. */
  readonly done: boolean;
  /** Refs of the items it depends on. */
  readonly dependencies: ReadonlyArray<string>;
  readonly description?: string;
  /** The Hub key of a root. */
  readonly key?: string;
  /** The area of a root; null for none. */
  readonly area?: string | null;
}

/** What the last import wrote for one item, or agreed with; a field it never wrote is absent. */
export interface SyncedItem {
  readonly task: string;
  readonly title: string;
  readonly area?: string | null;
  /** The task id it was put under; null for a root. */
  readonly parent?: string | null;
  readonly position?: number;
  readonly kind?: PeerTaskKind;
  readonly executable?: boolean;
  readonly unsettled?: boolean;
  readonly status?: PeerTask["status"];
  readonly description?: string;
  /** Refs whose dependency edges were recorded. */
  readonly dependencies?: ReadonlyArray<string>;
}

/** One project's import, by ref. */
export type SyncRecord = Readonly<Record<string, SyncedItem>>;

/**
 * A record as an older import or any other hand left it: entries without a task id are dropped.
 * The import before the tree kept `{ task, title, area }` per change id, which is the root's ref.
 */
export const syncRecordOf = (value: unknown): SyncRecord =>
  typeof value !== "object" || value === null
    ? {}
    : Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, SyncedItem] =>
            typeof entry[1] === "object" &&
            entry[1] !== null &&
            typeof (entry[1] as { task?: unknown }).task === "string" &&
            typeof (entry[1] as { title?: unknown }).title === "string",
        ),
      );

/** The Hub clips a description there; an import that wrote more would see Peer's edit in the cut. */
export const DESCRIPTION_LIMIT = 4000;

/** Each step becomes a `- ` line of the description of its nearest group or task, and is removed. */
export const foldSteps = (items: ReadonlyArray<WorkItem>): ReadonlyArray<WorkItem> => {
  const byRef = new Map(items.map((item) => [item.ref, item]));
  const lines = new Map<string, Array<string>>();
  for (const item of items) {
    if (item.kind !== "step") continue;
    let owner = item.parent === null ? undefined : byRef.get(item.parent);
    while (owner?.kind === "step")
      owner = owner.parent === null ? undefined : byRef.get(owner.parent);
    if (owner !== undefined)
      lines.set(owner.ref, [...(lines.get(owner.ref) ?? []), `- ${item.title}`]);
  }
  return items.flatMap((item) => {
    if (item.kind === "step") return [];
    const steps = lines.get(item.ref);
    if (steps === undefined) return [item];
    const description = [item.description, steps.join("\n")]
      .filter((part) => part !== undefined && part !== "")
      .join("\n\n")
      .slice(0, DESCRIPTION_LIMIT);
    return [{ ...item, description }];
  });
};

/** A change to one task; `parent` names the item to sit under, resolved to its task when applied. */
export interface SyncChange {
  readonly title?: string;
  /** Null clears it. */
  readonly area?: string | null;
  readonly parent?: { readonly ref: string | null };
  readonly position?: number;
  readonly kind?: PeerTaskKind;
  readonly executable?: boolean;
  readonly unsettled?: boolean;
  readonly status?: "open" | "done";
  readonly description?: string;
  readonly source?: { readonly system: string; readonly ref: string };
}

export type SyncStep =
  | {
      readonly kind: "create";
      readonly item: WorkItem;
      /** Dependency refs to record once every item exists. */
      readonly dependsOn: ReadonlyArray<string>;
    }
  | {
      readonly kind: "update" | "same" | "conflict";
      readonly item: WorkItem;
      readonly task: PeerTask;
      /** What to write: in a conflict, the fields that do not conflict. */
      readonly change: SyncChange;
      /** What differs on both sides, in words; empty unless a conflict. */
      readonly fields: ReadonlyArray<string>;
      readonly dependsOn: ReadonlyArray<string>;
      /** What the record holds for it once this is applied, the task id aside. */
      readonly next: Omit<SyncedItem, "task">;
      /** Whether it is still unsettled in Peer once this is applied. */
      readonly unsettled: boolean;
    }
  | { readonly kind: "gone"; readonly ref: string; readonly task: PeerTask };

export interface SyncOptions {
  /** `source.system` of the tasks this import writes. */
  readonly system: string;
  /**
   * The Hub keeps the tree (`treeServed`). An older Hub gets the roots only, as tasks, and only
   * their titles and areas follow the source.
   */
  readonly tree: boolean;
  /** The Hub records dependencies. */
  readonly dependencies: boolean;
}

/** Whether the Hub keeps the tree: its view gives every task `executable`, an older Hub none. */
export const treeServed = (tasks: ReadonlyArray<PeerTask>) =>
  tasks.length === 0 || tasks.some((task) => task.executable !== undefined);

const folded = (title: string) => title.trim().replace(/\s+/g, " ").toLowerCase();
const siblingOrder = (a: PeerTask, b: PeerTask) =>
  (a.position ?? 0) - (b.position ?? 0) ||
  a.createdAt.localeCompare(b.createdAt) ||
  a.id.localeCompare(b.id);

/** The parent an item is to have, before its parent exists: never equal to a task id. */
const pending = (ref: string) => `\u0000${ref}`;

type Verdict = "same" | "update" | "conflict";
/**
 * The import's rule for one field: agree, or write the source's value where Peer still holds what
 * the import wrote, or keep Peer's when only Peer moved, or say both moved. A field the record does
 * not know (an older import never wrote it) counts as the import's own.
 */
const verdict = <T>(source: T, current: T, base: T | undefined, recorded: boolean): Verdict => {
  if (source === current) return "same";
  if (!recorded) return "conflict";
  const written = base === undefined ? current : base;
  if (current === written) return "update";
  return source === written ? "same" : "conflict";
};

/**
 * What synchronising `items` with a project's `tasks` would do, given `record`, in tree order
 * (parents before children). An item is the task the record names; else the task whose source is
 * its ref; else, for a root, the task with its key; else the task under the same parent with the
 * same title; else the unmatched task under the same parent of the same kind in the same place.
 */
export const planSync = (
  input: ReadonlyArray<WorkItem>,
  tasks: ReadonlyArray<PeerTask>,
  record: SyncRecord,
  options: SyncOptions,
): ReadonlyArray<SyncStep> => {
  const items = foldSteps(input).filter((item) => options.tree || item.parent === null);
  const refs = new Set(items.map((item) => item.ref));
  const children = new Map<string | null, Array<WorkItem>>();
  for (const item of items) {
    const parent = item.parent !== null && refs.has(item.parent) ? item.parent : null;
    children.set(parent, [...(children.get(parent) ?? []), item]);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.position - b.position);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const claimed = new Set<string>();
  const steps: Array<SyncStep> = [];

  const claim = (item: WorkItem, under: string | null): PeerTask | undefined => {
    const free = (task: PeerTask | undefined) =>
      task !== undefined && !claimed.has(task.id) ? task : undefined;
    const last = record[item.ref];
    const found =
      free(last === undefined ? undefined : byId.get(last.task)) ??
      free(
        tasks.find(
          (task) =>
            !claimed.has(task.id) &&
            task.source?.system === options.system &&
            task.source.ref === item.ref,
        ),
      ) ??
      // The Hub keeps keys in upper case.
      (item.parent === null && item.key !== undefined
        ? free(tasks.find((task) => task.key?.toLowerCase() === item.key!.toLowerCase()))
        : undefined) ??
      (under?.startsWith("\u0000") === true
        ? undefined
        : tasks.find(
            (task) =>
              !claimed.has(task.id) &&
              (task.parent ?? null) === under &&
              folded(task.title) === folded(item.title),
          ));
    if (found !== undefined) claimed.add(found.id);
    return found;
  };

  const step = (item: WorkItem, task: PeerTask, under: string | null): SyncStep => {
    const last = record[item.ref];
    const recorded = last !== undefined;
    const change: Record<string, unknown> = {};
    const next: Record<string, unknown> = {};
    const fields: Array<string> = [];
    const field = <T>(
      name: keyof Omit<SyncedItem, "task" | "dependencies">,
      source: T,
      current: T,
      words: string,
      write: () => void = () => {
        change[name] = source;
      },
      unrecorded: Verdict | undefined = undefined,
    ) => {
      const base = last?.[name] as T | undefined;
      const said =
        !recorded && unrecorded !== undefined && source !== current
          ? unrecorded
          : verdict(source, current, base, recorded);
      if (said === "update") write();
      if (said === "conflict") fields.push(words);
      // Where Peer's value stays, the record keeps what the import wrote, so that a later move of
      // the source shows as a conflict instead of passing over Peer's edit.
      next[name] = said === "update" || source === current ? source : (base ?? current);
    };
    field("title", item.title, task.title, "title");
    if (item.parent === null) {
      field("area", item.area ?? null, task.area ?? null, "area", () => {
        change.area = item.area ?? null;
      });
    }
    if (options.tree) {
      field("parent", under, task.parent ?? null, "place", () => {
        change.parent = { ref: item.parent };
      });
      field("position", item.position, task.position ?? 0, "order", undefined, "update");
      // A person who decided how an unsettled item runs decided its kind too.
      const decided = last?.unsettled === true && task.unsettled !== true;
      const kind = item.kind === "group" ? "group" : "task";
      if (!decided) {
        field("kind", kind, taskKind(task), "kind");
        field("executable", item.executable, isExecutable(task), "whether it runs as one");
        field("unsettled", item.unsettled, task.unsettled === true, "whether it is settled");
      } else {
        next.kind = taskKind(task);
        next.executable = isExecutable(task);
        next.unsettled = false;
      }
      field(
        "description",
        item.description ?? "",
        task.description ?? "",
        "description",
        () => {
          change.description = item.description ?? "";
        },
        (task.description ?? "") === "" ? "update" : "conflict",
      );
      if (task.source?.system !== options.system || task.source.ref !== item.ref) {
        change.source = { system: options.system, ref: item.ref };
      }
    }
    const runs =
      change.executable === undefined ? isExecutable(task) : (change.executable as boolean);
    // An item that is not executable shows its items' status, and a review waits for a person.
    if (options.tree && runs && task.status !== "review") {
      const status = item.done ? "done" : "open";
      // The import before the tree never wrote a status: a person's stays.
      if (last?.status !== undefined) field("status", status, task.status, "status");
      else next.status = task.status;
    } else {
      next.status = task.status;
    }
    const known = new Set(last?.dependencies ?? []);
    const dependsOn = options.dependencies
      ? item.dependencies.filter((ref) => refs.has(ref) && !known.has(ref))
      : [];
    next.dependencies = [...known, ...dependsOn];
    const unsettled =
      change.unsettled === undefined ? task.unsettled === true : (change.unsettled as boolean);
    const kind =
      fields.length > 0
        ? "conflict"
        : Object.keys(change).length > 0 || dependsOn.length > 0
          ? "update"
          : "same";
    return {
      kind,
      item,
      task,
      change: change as SyncChange,
      fields,
      dependsOn,
      next: next as Omit<SyncedItem, "task">,
      unsettled,
    };
  };

  const visit = (parentRef: string | null, under: string | null) => {
    const siblings = children.get(parentRef) ?? [];
    const matched = new Map(siblings.map((item) => [item.ref, claim(item, under)]));
    // By place last, and never among the roots, where people's own tasks are.
    if (under !== null && !under.startsWith("\u0000")) {
      const kindOf = (item: WorkItem) => (item.kind === "group" ? "group" : "task");
      for (const kind of ["group", "task"] as const) {
        const hubSiblings = tasks
          .filter((task) => (task.parent ?? null) === under && taskKind(task) === kind)
          .toSorted(siblingOrder);
        siblings
          .filter((item) => kindOf(item) === kind)
          .forEach((item, ordinal) => {
            const task = hubSiblings[ordinal];
            if (matched.get(item.ref) !== undefined || task === undefined) return;
            if (claimed.has(task.id)) return;
            claimed.add(task.id);
            matched.set(item.ref, task);
          });
      }
    }
    for (const item of siblings) {
      const task = matched.get(item.ref);
      const known = record[item.ref]?.dependencies ?? [];
      steps.push(
        task === undefined
          ? {
              kind: "create",
              item,
              dependsOn: options.dependencies
                ? item.dependencies.filter((ref) => refs.has(ref) && !known.includes(ref))
                : [],
            }
          : step(item, task, under),
      );
      visit(item.ref, task?.id ?? pending(item.ref));
    }
  };
  visit(null, null);

  for (const [ref, last] of Object.entries(record)) {
    if (refs.has(ref) || claimed.has(last.task)) continue;
    // An older Hub's import planned the roots only; the rest of the record waits for a newer one.
    if (!options.tree && ref.includes("#")) continue;
    const task = byId.get(last.task);
    if (task !== undefined) steps.push({ kind: "gone", ref, task });
  }
  return steps;
};

/** Whether this step leaves its item unsettled in Peer. */
const leavesUnsettled = (step: SyncStep) =>
  step.kind === "create" ? step.item.unsettled : step.kind === "gone" ? false : step.unsettled;

/** The plan in a line (D8 of add-work-item-tree). */
export const syncSummary = (steps: ReadonlyArray<SyncStep>, dependencies: boolean) => {
  const count = (kind: SyncStep["kind"]) => steps.filter((step) => step.kind === kind).length;
  const items = steps.length - count("gone");
  return [
    `${items} item${items === 1 ? "" : "s"}: ${count("create")} new, ${count("update")} to update, ${count("conflict")} in conflict, ${count("same")} up to date, ${count("gone")} gone`,
    `${steps.filter(leavesUnsettled).length} unsettled`,
    `dependencies: ${dependencies ? "recorded" : "not served by this Hub"}`,
  ].join("; ");
};

export interface SyncTarget {
  readonly workspace: string;
  readonly project: string;
}

/**
 * Applies a plan through PeerWork: creates parents before children (a created parent's id goes to
 * its children), changes what moved, then records the dependency edges once every item exists. The
 * record is saved after every write, so a failure loses nothing; a conflict and a gone item are
 * said, never written. Answers the record and whether the Hub took the dependencies.
 */
export const applySync = Effect.fn("workItems.applySync")(function* (input: {
  readonly target: SyncTarget;
  readonly steps: ReadonlyArray<SyncStep>;
  readonly record: SyncRecord;
  readonly options: SyncOptions;
  readonly save: (record: SyncRecord) => Effect.Effect<void>;
  readonly say: (line: string) => Effect.Effect<void>;
}) {
  const work = yield* PeerWork.PeerWork;
  const { workspace, project } = input.target;
  const record: Record<string, SyncedItem> = { ...input.record };
  const save = Effect.suspend(() => input.save({ ...record }));
  const taskOf = new Map<string, string>();
  for (const step of input.steps) {
    if (step.kind === "update" || step.kind === "same" || step.kind === "conflict") {
      taskOf.set(step.item.ref, step.task.id);
    }
  }
  const parentId = (ref: string | null) => (ref === null ? undefined : taskOf.get(ref));
  const sourceOf = (item: WorkItem) => ({ system: input.options.system, ref: item.ref });
  const update = (
    taskId: string,
    change: Omit<PeerHubUpdateTaskInput, "workspace" | "projectId" | "taskId">,
  ) =>
    work
      .updateTask({ workspace, projectId: project, taskId, ...change })
      .pipe(Effect.tapError(() => save));

  for (const step of input.steps) {
    if (step.kind === "gone") {
      yield* input.say(
        `− ${step.task.title} · ${step.ref}: no longer in the source; the task stays in Peer.`,
      );
      continue;
    }
    const { item } = step;
    if (step.kind === "create") {
      const parent = input.options.tree ? parentId(item.parent) : undefined;
      const kind = item.kind === "group" ? "group" : "task";
      const { createdTask } = yield* work
        .createTask({
          workspace,
          projectId: project,
          title: item.title,
          ...(item.key === undefined ? {} : { key: item.key }),
          ...(item.parent === null && item.area !== undefined && item.area !== null
            ? { area: item.area }
            : {}),
          ...(input.options.tree
            ? {
                ...(parent === undefined ? {} : { parent }),
                kind,
                executable: item.executable,
                unsettled: item.unsettled,
                position: item.position,
                ...(item.description === undefined ? {} : { description: item.description }),
                source: sourceOf(item),
              }
            : {}),
        })
        .pipe(Effect.tapError(() => save));
      taskOf.set(item.ref, createdTask.id);
      const done = input.options.tree && item.executable && item.done;
      const base = { task: createdTask.id, title: item.title, area: item.area ?? null };
      // An older Hub was told the title and area only: the fields it was not told stay unknown, so
      // that the first import against a newer Hub writes them.
      record[item.ref] = input.options.tree
        ? {
            ...base,
            parent: createdTask.parent ?? null,
            position: item.position,
            kind,
            executable: item.executable,
            unsettled: item.unsettled,
            status: done ? "done" : "open",
            description: item.description ?? "",
            dependencies: [],
          }
        : base;
      yield* save;
      if (done) {
        yield* update(createdTask.id, { status: "done" });
      }
      yield* input.say(`+ ${item.title} · ${item.ref}`);
      if (item.unsettled) {
        yield* input.say(`? ${item.title}: run it as one task, or by its parts? Decide in Peer.`);
      }
      continue;
    }
    const { change } = step;
    if (Object.keys(change).length > 0) {
      const parent =
        change.parent === undefined
          ? undefined
          : change.parent.ref === null
            ? ""
            : parentId(change.parent.ref);
      yield* update(step.task.id, {
        ...(change.title === undefined ? {} : { title: change.title }),
        ...(change.area === undefined ? {} : { area: change.area ?? "" }),
        ...(parent === undefined ? {} : { parent }),
        ...(change.position === undefined ? {} : { position: change.position }),
        ...(change.kind === undefined ? {} : { kind: change.kind }),
        ...(change.executable === undefined ? {} : { executable: change.executable }),
        // The Hub settles an item whose `executable` is set unless told otherwise.
        ...(change.unsettled !== undefined
          ? { unsettled: change.unsettled }
          : change.executable !== undefined
            ? { unsettled: step.unsettled }
            : {}),
        ...(change.status === undefined ? {} : { status: change.status }),
        ...(change.description === undefined ? {} : { description: change.description }),
        ...(change.source === undefined ? {} : { source: change.source }),
      });
    }
    const resolved =
      typeof step.next.parent === "string" && step.next.parent.startsWith("\u0000")
        ? (parentId(item.parent) ?? null)
        : step.next.parent;
    record[item.ref] = {
      ...step.next,
      task: step.task.id,
      ...(resolved === undefined ? {} : { parent: resolved }),
      dependencies: record[item.ref]?.dependencies ?? [],
    };
    if (step.kind === "update") {
      yield* save;
      yield* input.say(`~ ${change.title ?? step.task.title} · ${item.ref}`);
    }
    if (step.kind === "conflict") {
      yield* input.say(
        `! ${step.task.title} · ${item.ref}: the ${step.fields.join(" and ")} changed in the source and in Peer; Peer's stays. Change one of them to match.`,
      );
    }
    if (step.unsettled && step.kind === "update") {
      yield* input.say(
        `? ${step.task.title}: run it as one task, or by its parts? Decide in Peer.`,
      );
    }
  }

  let dependencies = input.options.dependencies;
  const edges = input.steps.filter(
    (step): step is Exclude<SyncStep, { kind: "gone" }> =>
      step.kind !== "gone" && step.dependsOn.length > 0,
  );
  if (dependencies && edges.length > 0) {
    const client = yield* PeerHubClient.PeerHubClient;
    const { hubUrl, session } = yield* client.session;
    for (const step of edges) {
      const task = taskOf.get(step.item.ref);
      const add = step.dependsOn.flatMap((ref) => taskOf.get(ref) ?? []);
      if (task === undefined || add.length === 0) continue;
      const answer = yield* client.api
        .dependencies(hubUrl, session, workspace, project, task, { add })
        .pipe(Effect.tapError(() => save));
      if (answer === null) {
        dependencies = false;
        break;
      }
      const last = record[step.item.ref];
      if (last !== undefined) {
        record[step.item.ref] = {
          ...last,
          dependencies: [...(last.dependencies ?? []), ...step.dependsOn],
        };
      }
      yield* save;
    }
  }
  yield* save;
  return { record: { ...record } as SyncRecord, dependencies };
});
