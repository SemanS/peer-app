// @effect-diagnostics nodeBuiltinImport:off - the record of what was imported.
/**
 * OpenSpec in a connected project: each active change (`openspec/changes/<id>/`, not `archive`)
 * becomes a tree of Peer tasks (`openspecItems.ts`) whose root's key is the change's id, in the
 * project area that one of its capabilities names, when one does. Importing again goes through
 * `workItems.ts`: only what is new is created, a task is updated only where the change moved and
 * Peer did not, an edit on both sides is a conflict to show, and nothing is deleted. What the last
 * import wrote is kept in `<stateDir>/openspec-sync.json`.
 *
 * @module cli/peerCoreOpenSpec
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as PeerHubClient from "../peerHub/core/hub/PeerHubClient.ts";
import {
  applySync,
  planSync,
  syncRecordOf,
  syncSummary,
  treeServed,
  type SyncOptions,
  type SyncRecord,
  type SyncStep,
  type WorkItem,
} from "../peerHub/core/work/workItems.ts";
import { readChange, readChanges } from "./openspecItems.ts";
import type { OneShotIo } from "./peerCoreIo.ts";

export {
  areaOf,
  changeTitle,
  keyOf,
  readChange,
  readChanges,
  titleOfId,
  type Change,
} from "./openspecItems.ts";

/** Per project (`workspace/project`), per item ref; a change's root's ref is its id. */
export type ImportRecord = Readonly<Record<string, SyncRecord>>;

const SYSTEM = "openspec";

/** The plan in a line, as `workItems.ts` counts it. */
export const summary = (steps: ReadonlyArray<SyncStep>, dependencies: boolean) =>
  syncSummary(steps, dependencies);

const recordPath = (stateDir: string) => NodePath.join(stateDir, "openspec-sync.json");

/** The record as any earlier import left it; entries keyed by a change id are its root's. */
export const readRecord = (stateDir: string): Promise<ImportRecord> =>
  NodeFSP.readFile(recordPath(stateDir), "utf8")
    .then((text) => {
      const value: unknown = JSON.parse(text);
      return typeof value === "object" && value !== null
        ? Object.fromEntries(
            Object.entries(value).map(([project, entries]) => [project, syncRecordOf(entries)]),
          )
        : {};
    })
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

export interface Prepared {
  readonly items: ReadonlyArray<WorkItem>;
  readonly notInterpreted: ReadonlyArray<string>;
  readonly options: SyncOptions;
  readonly steps: ReadonlyArray<SyncStep>;
}

/** The project's tasks as the Hub says now, the changes here as items, and the plan. */
export const prepare = (target: SyncTarget) =>
  Effect.gen(function* () {
    const changes = yield* Effect.promise(() => readChanges(target.root));
    if (changes === null) return null;
    const client = yield* PeerHubClient.PeerHubClient;
    const { hubUrl, session } = yield* client.session;
    const work = yield* client.api.work(hubUrl, session, target.workspace);
    const project = work.projects[target.project];
    const tasks = project?.tasks ?? [];
    const areas = project?.areas ?? [];
    const read = yield* Effect.promise(() =>
      Promise.all(changes.map((change) => readChange(target.root, change.id, areas))),
    );
    // Changes in the order they are listed, one after another among the project's roots.
    const items = read.flatMap(({ items: own }, index) =>
      own.map((item) => (item.parent === null ? { ...item, position: index } : item)),
    );
    const me = yield* client.me.pipe(Effect.option);
    const features = Option.isSome(me)
      ? PeerHubClient.featuresOf(me.value)
      : yield* client.features;
    const options: SyncOptions = {
      system: SYSTEM,
      tree: treeServed(tasks),
      dependencies: "dependencies" in features,
    };
    const record = (yield* Effect.promise(() => readRecord(target.stateDir)))[
      `${target.workspace}/${target.project}`
    ];
    return {
      items,
      notInterpreted: [...new Set(read.flatMap((change) => change.notInterpreted))],
      options,
      steps: planSync(items, tasks, record ?? {}, options),
    } satisfies Prepared;
  });

const notInterpretedBlock = (io: OneShotIo, lines: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (lines.length === 0) return;
    yield* io.say("Not interpreted:");
    for (const line of lines) yield* io.say(`  ${line}`);
  });

/**
 * Applies a prepared plan and records what it wrote after every write; a conflict and a gone item
 * are said, never written; a failure stops with what was done recorded.
 */
export const apply = (target: SyncTarget, prepared: Prepared, io: OneShotIo) =>
  Effect.gen(function* () {
    const key = `${target.workspace}/${target.project}`;
    const record = yield* Effect.promise(() => readRecord(target.stateDir));
    const result = yield* applySync({
      target,
      steps: prepared.steps,
      record: record[key] ?? {},
      options: prepared.options,
      save: (mine) =>
        Effect.promise(async () =>
          writeRecord(target.stateDir, { ...(await readRecord(target.stateDir)), [key]: mine }),
        ),
      say: io.say,
    });
    if (prepared.options.dependencies && !result.dependencies)
      yield* io.say(
        "This Peer Hub does not record dependencies; the Depends on lines were left out.",
      );
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
    yield* io.say(summary(steps, prepared.options.dependencies));
    const writes = steps.filter((step) => step.kind === "create" || step.kind === "update");
    if (writes.length === 0) {
      // A task that agrees is still adopted, so the next change to it updates it.
      yield* apply(target, prepared, io);
      yield* notInterpretedBlock(io, prepared.notInterpreted);
      return true;
    }
    if (!(yield* confirm(`Import ${writes.length} into ${target.workspace}/${target.project}?`))) {
      yield* io.say("Nothing imported.");
      yield* notInterpretedBlock(io, prepared.notInterpreted);
      return true;
    }
    yield* apply(target, prepared, io);
    yield* io.say(
      "Imported. A change's task key is its id (shortened past 32 characters), so a branch named with it attaches to the task.",
    );
    yield* notInterpretedBlock(io, prepared.notInterpreted);
    return true;
  });
