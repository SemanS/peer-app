import * as Effect from "effect/Effect";
import type { VcsCheckpointOps } from "./VcsDriver.ts";

const unexpectedCheckpoint = () => Effect.die("Unexpected checkpoint operation in fixture");
export const unusedCheckpoints: VcsCheckpointOps = {
  captureCheckpoint: unexpectedCheckpoint,
  hasCheckpointRef: unexpectedCheckpoint,
  restoreCheckpoint: unexpectedCheckpoint,
  diffCheckpoints: unexpectedCheckpoint,
  listAuthoredPaths: unexpectedCheckpoint,
  deleteCheckpointRefs: unexpectedCheckpoint,
};
export const jjCapabilities = {
  kind: "jj",
  supportsWorktrees: false,
  supportsBookmarks: true,
  supportsAtomicSnapshot: true,
  supportsPushDefaultRemote: false,
  ignoreClassifier: "git-compatible-fallback",
} as const;
