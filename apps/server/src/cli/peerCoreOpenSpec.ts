// @effect-diagnostics nodeBuiltinImport:off - a repository's openspec/ folder and the record of what was imported.
/**
 * OpenSpec in a connected project: each active change (`openspec/changes/<id>/`, not `archive`)
 * becomes one Peer task whose key is the change's id, in the project area that one of its
 * capabilities (`specs/<capability>/`) names, when one does. Importing again creates only what is
 * new and updates a task only where the change moved and Peer did not: what the last import wrote
 * is kept in `<stateDir>/openspec-sync.json`, so an edit made in Peer is never written over, and an
 * edit on both sides is a conflict to show. Statuses, owners and everything else Peer holds are
 * never touched.
 *
 * @module cli/peerCoreOpenSpec
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { PeerTask } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as PeerHubClient from "../peerHub/core/hub/PeerHubClient.ts";
import * as PeerWork from "../peerHub/core/work/PeerWork.ts";
import type { OneShotIo } from "./peerCoreIo.ts";

/** An active OpenSpec change, as the import reads it. */
export interface Change {
  readonly id: string;
  readonly title: string;
  /** Its capabilities: the folders under `specs/`. */
  readonly capabilities: ReadonlyArray<string>;
  readonly done: number;
  readonly total: number;
}

/** What one change's task looked like when it was last imported. */
export interface Imported {
  readonly task: string;
  readonly title: string;
  readonly area: string | null;
}

/** Per project (`workspace/project`), per change id. */
export type ImportRecord = Readonly<Record<string, Readonly<Record<string, Imported>>>>;

const GENERIC_TITLE = /^(proposal|change proposal|change)$/i;

/** `add-draft-surveys` → `Add draft surveys`. */
export const titleOfId = (id: string) => {
  const words = id.replace(/[-_]+/g, " ").trim();
  return words === "" ? id : `${words[0]!.toUpperCase()}${words.slice(1)}`;
};

/** The proposal's first heading when it names the change (`# Change: X` → `X`), else the id's words. */
export const changeTitle = (id: string, proposal: string | null) => {
  const heading = proposal
    ?.split("\n")
    .find((line) => /^#\s+\S/.test(line))
    ?.replace(/^#\s+/, "")
    .replace(/^(change|proposal)\s*:\s*/i, "")
    .trim();
  return heading === undefined || heading === "" || GENERIC_TITLE.test(heading)
    ? titleOfId(id)
    : heading.slice(0, 200);
};

const readText = (path: string) => NodeFSP.readFile(path, "utf8").catch(() => null);
const folders = async (path: string) =>
  (await NodeFSP.readdir(path, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();

/** The active changes under `root/openspec/changes`; null when the project has no OpenSpec. */
export async function readChanges(root: string): Promise<ReadonlyArray<Change> | null> {
  const dir = NodePath.join(root, "openspec", "changes");
  const stat = await NodeFSP.stat(dir).catch(() => null);
  if (stat === null || !stat.isDirectory()) return null;
  const changes: Array<Change> = [];
  for (const id of await folders(dir)) {
    if (id === "archive") continue;
    const tasks = (await readText(NodePath.join(dir, id, "tasks.md"))) ?? "";
    changes.push({
      id,
      title: changeTitle(id, await readText(NodePath.join(dir, id, "proposal.md"))),
      capabilities: await folders(NodePath.join(dir, id, "specs")),
      done: (tasks.match(/^\s*[-*] \[[xX]\]/gm) ?? []).length,
      total: (tasks.match(/^\s*[-*] \[[ xX]\]/gm) ?? []).length,
    });
  }
  return changes;
}

/** What the Hub takes as a task key: 2 to 32 characters, letters and digits between dashes. */
const KEY = /^(?=.{2,32}$)[a-z0-9]+(-[a-z0-9]+)*$/i;

/**
 * The task key of a change: its id, or, when the Hub would refuse that (too long, other
 * characters), its first words and a short hash of the whole id, the same on every computer.
 */
export const keyOf = (id: string) => {
  if (KEY.test(id)) return id;
  const hash = NodeCrypto.createHash("sha256").update(id).digest("hex").slice(0, 4);
  const words = id
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
  let head = "";
  for (const word of words) {
    const next = head === "" ? word : `${head}-${word}`;
    if (next.length > 27) break;
    head = next;
  }
  return head === "" ? `os-${hash}` : `${head.slice(0, 27)}-${hash}`;
};

const comparable = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** The project area one of the change's capabilities names, when exactly one area matches. */
export const areaOf = (change: Change, areas: ReadonlyArray<string>) => {
  const matched = new Set(
    areas.filter((area) =>
      change.capabilities.some((capability) => comparable(capability) === comparable(area)),
    ),
  );
  return matched.size === 1 ? [...matched][0]! : null;
};

export type Step =
  | { readonly kind: "create"; readonly change: Change; readonly area: string | null }
  | {
      readonly kind: "update";
      readonly change: Change;
      readonly task: PeerTask;
      readonly title?: string;
      /** null clears the area. */
      readonly area?: string | null;
    }
  | {
      readonly kind: "conflict";
      readonly change: Change;
      readonly task: PeerTask;
      /** What differs on both sides, in words. */
      readonly fields: ReadonlyArray<string>;
    }
  | { readonly kind: "same"; readonly change: Change; readonly task: PeerTask };

/**
 * What importing `changes` into a project would do, given its tasks and areas now and what the
 * last import wrote. A field is updated only when the change moved and Peer still holds what the
 * import wrote; a field both sides changed differently is a conflict; a task with the change's key
 * that no import wrote is adopted only where it already agrees.
 */
export const plan = (
  changes: ReadonlyArray<Change>,
  tasks: ReadonlyArray<PeerTask>,
  areas: ReadonlyArray<string>,
  record: Readonly<Record<string, Imported>>,
): ReadonlyArray<Step> =>
  changes.map((change): Step => {
    const area = areaOf(change, areas);
    const last = record[change.id];
    const task =
      tasks.find((t) => last !== undefined && t.id === last.task) ??
      // The Hub keeps keys in upper case.
      tasks.find((t) => t.key?.toLowerCase() === keyOf(change.id).toLowerCase());
    if (task === undefined) return { kind: "create", change, area };
    const base = last ?? { task: task.id, title: task.title, area: task.area ?? null };
    const fields: Array<string> = [];
    let title: string | undefined;
    let nextArea: string | null | undefined;
    // Without an import of its own, a task that differs was written by a person: never over it.
    if (change.title !== task.title) {
      if (last !== undefined && task.title === base.title) title = change.title;
      else if (last === undefined || change.title !== base.title) fields.push("title");
    }
    const held = task.area ?? null;
    if (area !== held) {
      if (last !== undefined && held === base.area) nextArea = area;
      else if (last === undefined || area !== base.area) fields.push("area");
    }
    if (fields.length > 0) return { kind: "conflict", change, task, fields };
    if (title === undefined && nextArea === undefined) return { kind: "same", change, task };
    return {
      kind: "update",
      change,
      task,
      ...(title === undefined ? {} : { title }),
      ...(nextArea === undefined ? {} : { area: nextArea }),
    };
  });

/** The plan in a line: what is new, what moves, what conflicts. */
export const summary = (steps: ReadonlyArray<Step>) => {
  const count = (kind: Step["kind"]) => steps.filter((s) => s.kind === kind).length;
  const parts = [
    `${count("create")} new`,
    `${count("update")} to update`,
    ...(count("conflict") > 0 ? [`${count("conflict")} in conflict`] : []),
    `${count("same")} up to date`,
  ];
  return `${steps.length} OpenSpec change${steps.length === 1 ? "" : "s"}: ${parts.join(", ")}`;
};

const recordPath = (stateDir: string) => NodePath.join(stateDir, "openspec-sync.json");

export const readRecord = (stateDir: string): Promise<ImportRecord> =>
  NodeFSP.readFile(recordPath(stateDir), "utf8")
    .then((text) => JSON.parse(text) as ImportRecord)
    .catch(() => ({}));

const writeRecord = async (stateDir: string, record: ImportRecord) => {
  const path = recordPath(stateDir);
  await NodeFSP.writeFile(`${path}.tmp`, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  await NodeFSP.rename(`${path}.tmp`, path);
};

/** Forgets what was imported into a project that left its workspace. */
export const forgetProject = async (stateDir: string, workspace: string, project: string) => {
  const record = { ...(await readRecord(stateDir)) };
  if (!(`${workspace}/${project}` in record)) return;
  delete record[`${workspace}/${project}`];
  await writeRecord(stateDir, record);
};

export interface SyncTarget {
  readonly workspace: string;
  readonly project: string;
  /** The project's checkout here, holding `openspec/`. */
  readonly root: string;
  readonly stateDir: string;
}

/** The project's tasks and areas as the Hub says now, the changes here, and the plan. */
export const prepare = (target: SyncTarget) =>
  Effect.gen(function* () {
    const changes = yield* Effect.promise(() => readChanges(target.root));
    if (changes === null) return null;
    const client = yield* PeerHubClient.PeerHubClient;
    const { hubUrl, session } = yield* client.session;
    const work = yield* client.api.work(hubUrl, session, target.workspace);
    const project = work.projects[target.project];
    const areas = project?.areas ?? [];
    const record = yield* Effect.promise(() => readRecord(target.stateDir));
    const key = `${target.workspace}/${target.project}`;
    return {
      changes,
      areas,
      steps: plan(changes, project?.tasks ?? [], areas, record[key] ?? {}),
    };
  });

/**
 * Applies `steps`: creates and updates tasks through the Hub, and records what it wrote. A conflict
 * is said, never written; a failure stops with what was done recorded.
 */
export const apply = (target: SyncTarget, steps: ReadonlyArray<Step>, io: OneShotIo) =>
  Effect.gen(function* () {
    const work = yield* PeerWork.PeerWork;
    const key = `${target.workspace}/${target.project}`;
    const record = { ...(yield* Effect.promise(() => readRecord(target.stateDir))) };
    const mine: Record<string, Imported> = { ...record[key] };
    const save = Effect.promise(() => writeRecord(target.stateDir, { ...record, [key]: mine }));
    for (const step of steps) {
      if (step.kind === "create") {
        const { createdTask } = yield* work
          .createTask({
            workspace: target.workspace,
            projectId: target.project,
            title: step.change.title,
            key: keyOf(step.change.id),
            ...(step.area === null ? {} : { area: step.area }),
          })
          .pipe(Effect.tapError(() => save));
        mine[step.change.id] = { task: createdTask.id, title: step.change.title, area: step.area };
        yield* io.say(
          `+ ${step.change.title}${step.area === null ? "" : ` (${step.area})`} · ${step.change.id}`,
        );
      } else if (step.kind === "update") {
        yield* work
          .updateTask({
            workspace: target.workspace,
            projectId: target.project,
            taskId: step.task.id,
            ...(step.title === undefined ? {} : { title: step.title }),
            ...(step.area === undefined ? {} : { area: step.area ?? "" }),
          })
          .pipe(Effect.tapError(() => save));
        mine[step.change.id] = {
          task: step.task.id,
          title: step.title ?? step.task.title,
          area: step.area === undefined ? (step.task.area ?? null) : step.area,
        };
        yield* io.say(`~ ${step.title ?? step.task.title} · ${step.change.id}`);
      } else if (step.kind === "conflict") {
        yield* io.say(
          `! ${step.task.title} · ${step.change.id}: the ${step.fields.join(" and ")} changed in OpenSpec and in Peer; Peer's stays. Change one of them to match.`,
        );
      } else if (mine[step.change.id] === undefined)
        // A task with the change's key that agrees is adopted, so later changes update it.
        mine[step.change.id] = {
          task: step.task.id,
          title: step.task.title,
          area: step.task.area ?? null,
        };
    }
    yield* save;
  });

/**
 * Shows what importing would do and, when something would change and `confirm` agrees, does it.
 * Nothing to import says so; a project without `openspec/` says nothing and returns false.
 */
export const sync = <R>(
  target: SyncTarget,
  confirm: (message: string) => Effect.Effect<boolean, never, R>,
  io: OneShotIo,
) =>
  Effect.gen(function* () {
    const prepared = yield* prepare(target);
    if (prepared === null) return false;
    const { steps } = prepared;
    yield* io.say(summary(steps));
    for (const step of steps)
      if (step.kind === "conflict")
        yield* io.say(
          `! ${step.change.id}: the ${step.fields.join(" and ")} differs in Peer (${step.task.title}); Peer's stays.`,
        );
    const work = steps.filter((step) => step.kind === "create" || step.kind === "update");
    if (work.length === 0) {
      // A task that agrees is still adopted, so the next change to it updates it.
      yield* apply(target, steps, io);
      return true;
    }
    if (
      !(yield* confirm(`Import ${work.length} as tasks of ${target.workspace}/${target.project}?`))
    ) {
      yield* io.say("Nothing imported.");
      return true;
    }
    yield* apply(target, steps, io);
    yield* io.say(
      "Imported. A task's key is its change's id (shortened past 32 characters), so a branch named with it attaches to the task.",
    );
    return true;
  });
