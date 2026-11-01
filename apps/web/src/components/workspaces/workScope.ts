import * as Schema from "effect/Schema";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { ALL_PROJECTS } from "@t3tools/client-runtime/peer/work";

const StoredScope = Schema.NullOr(Schema.String);

/**
 * The one project scope of the sidebar's Tasks and Chats views and the Work board: `all`, a
 * workspace project (`<workspace>/<project>`), or a project of this computer that no workspace
 * shares (`local:<project key>`, which only the Chats list and the project menu know). Picking a
 * project anywhere scopes the others, and it outlives a restart.
 */
export function useWorkScope(): readonly [string, (scope: string) => void] {
  const [stored, setStored] = useLocalStorage("peer:work-scope", null, StoredScope);
  return [stored ?? ALL_PROJECTS, setStored];
}
