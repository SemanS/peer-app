import * as Schema from "effect/Schema";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { ALL_PROJECTS } from "./workBoard.logic";

const StoredScope = Schema.NullOr(Schema.String);

/**
 * The project the Work views show: `all`, or `<workspace>/<project>`. The sidebar and the Work
 * board share it, so picking a project in one scopes the other, and it outlives a restart.
 */
export function useWorkScope(): readonly [string, (scope: string) => void] {
  const [stored, setStored] = useLocalStorage("peer:work-scope", null, StoredScope);
  return [stored ?? ALL_PROJECTS, setStored];
}
