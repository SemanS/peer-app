import * as Schema from "effect/Schema";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { scopeAfterSwitch } from "./activeOrganization.logic";
import { ALL_PROJECTS } from "./workBoard.logic";
import { useWorkScope } from "./workScope";

const StoredWorkspace = Schema.NullOr(Schema.String);

/**
 * The workspace the person chose last here (`peer:settings-workspace`): the active organization,
 * which Settings' pages that name no workspace keep showing too.
 */
export function useChosenWorkspace() {
  return useLocalStorage("peer:settings-workspace", null, StoredWorkspace);
}

/**
 * The organization chosen here and how to change it. Choosing one also moves Work's project scope
 * off another organization's project; forgetting drops every key that names a workspace.
 */
export function useActiveOrganization() {
  const [chosen, setChosen] = useChosenWorkspace();
  const [scope, setScope] = useWorkScope();
  return {
    chosen,
    scope,
    choose: (slug: string) => {
      setChosen(slug);
      setScope(scopeAfterSwitch(scope, slug));
    },
    /** Drops the chosen workspace, the Work scope's, or both. */
    forget: (keys: { readonly workspace: boolean; readonly scope: boolean }) => {
      if (keys.workspace) setChosen(null);
      if (keys.scope) setScope(ALL_PROJECTS);
    },
  };
}
