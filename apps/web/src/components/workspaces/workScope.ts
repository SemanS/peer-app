import * as Schema from "effect/Schema";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { ALL_PROJECTS } from "./workBoard.logic";

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

const StoredLayout = Schema.NullOr(Schema.Literals(["board", "list"]));

/**
 * How the Work screen lays tasks out, the board or the list (`peer:work-board-layout`, which the
 * Work board reads too). The sidebar's Tasks row sets it to the list.
 */
export function useWorkLayout(): readonly ["board" | "list", (layout: "board" | "list") => void] {
  const [stored, setStored] = useLocalStorage("peer:work-board-layout", null, StoredLayout);
  return [stored ?? "board", setStored];
}
