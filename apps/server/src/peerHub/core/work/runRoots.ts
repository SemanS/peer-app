/**
 * The other projects' checkouts of a run that works across a workspace's shared room. A run belongs
 * to one project and task; these say where else it works, for the room's diff and snapshots there
 * and for a continued run's harness. Kept in the rooms plugin's state, which starts such runs.
 *
 * @module peerHub/core/work/runRoots
 */
import * as Schema from "effect/Schema";

import type * as PeerState from "../state/PeerState.ts";

const RunRoot = Schema.Struct({
  project: Schema.String,
  repository: Schema.String,
  task: Schema.String,
  root: Schema.String,
});
export type RunRoot = typeof RunRoot.Type;

const RunRoots = Schema.Struct({ runs: Schema.Record(Schema.String, Schema.Array(RunRoot)) });

export const runRootsData = (state: PeerState.PeerState["Service"]) =>
  state.pluginData("rooms", RunRoots);
