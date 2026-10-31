import * as Schema from "effect/Schema";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import type { ProjectSet } from "./projectSets.logic";

const StoredSets = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    projects: Schema.Array(Schema.String),
  }),
);

const NO_SETS: ReadonlyArray<ProjectSet> = [];

/** This computer's project sets. They outlive a restart and stay here: see `projectSets.logic`. */
export function useProjectSets() {
  return useLocalStorage<ReadonlyArray<ProjectSet>, unknown>(
    "peer:project-sets",
    NO_SETS,
    StoredSets as Schema.Codec<ReadonlyArray<ProjectSet>, unknown>,
  );
}
