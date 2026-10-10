import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { ALL_PROJECTS } from "@t3tools/client-runtime/peer/work";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback } from "react";

import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../../state/preferences";

/**
 * The project the Work screen shows: `all`, or `<workspace>/<project>`. It is kept with the phone's
 * preferences, so the Home row names it and it outlives a restart.
 */
export function useWorkScope(): readonly [string, (scope: string) => void] {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const save = useAtomSet(updateMobilePreferencesAtom);
  const stored = AsyncResult.isSuccess(preferences) ? preferences.value.peerWorkScope : undefined;
  const choose = useCallback((scope: string) => save({ peerWorkScope: scope }), [save]);
  return [stored ?? ALL_PROJECTS, choose];
}
