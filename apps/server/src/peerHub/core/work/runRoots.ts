// @effect-diagnostics nodeBuiltinImport:off - paths are compared as the file system knows them.
/**
 * The other projects' checkouts of a run that works across a workspace's shared room. A run belongs
 * to one project and task; these say where else it works, for the room's diff and snapshots there
 * and for a continued run's harness. Kept in the rooms plugin's state, which starts such runs.
 *
 * @module peerHub/core/work/runRoots
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Schema from "effect/Schema";

import type * as PeerState from "../state/PeerState.ts";

const RunRoot = Schema.Struct({
  project: Schema.String,
  repository: Schema.String,
  /** Empty for a folder of no Hub project: its edits belong to no project's coordination. */
  task: Schema.String,
  root: Schema.String,
});
export type RunRoot = typeof RunRoot.Type;

const RoomFolder = Schema.Struct({ name: Schema.String, folder: Schema.String });

const RunRoots = Schema.Struct({
  runs: Schema.Record(Schema.String, Schema.Array(RunRoot)),
  /** Group → folders of projects no Hub workspace shares, which its room's agent works in too. */
  folders: Schema.optional(Schema.Record(Schema.String, Schema.Array(RoomFolder))),
});

export const runRootsData = (state: PeerState.PeerState["Service"]) =>
  state.pluginData("rooms", RunRoots);

/** A path as the file system knows it, as far as it exists: macOS keeps /var under /private. */
const real = (path: string): string => {
  try {
    return NodeFS.realpathSync(path);
  } catch {
    const parent = NodePath.dirname(path);
    return parent === path ? path : NodePath.join(real(parent), NodePath.basename(path));
  }
};

/** The entry whose checkout holds `path`. */
export const rootHolding = (roots: ReadonlyArray<RunRoot>, path: string): RunRoot | undefined => {
  const target = real(path);
  return roots.find((entry) => {
    if (entry.task === "") return false;
    const root = real(entry.root);
    return target === root || target.startsWith(`${root}${NodePath.sep}`);
  });
};

/** What tells a run where its other projects are, which nothing else in its session says. */
export const projectsText = (
  also: ReadonlyArray<{ readonly project: string; readonly root: string }>,
) =>
  [
    "This work spans several projects. Besides this folder, you work in these, each your own checkout on its own branch:",
    ...also.map((other) => `- ${other.project}: ${other.root}`),
    "Run version control per folder (git -C <folder>, or jj -R <folder>); each project commits and lands on its own. Before you change anything in a folder, read its AGENTS.md or CLAUDE.md, and its .ai knowledge if it has any: each project has its own rules. Run peer from a folder to act on that project: peer review there hands its work off. Answer in the room from this folder.",
  ].join("\n");
