/**
 * Whether this computer's pins of its agents' work go to origin: unpushed work, so its owner's
 * choice, off until they make it. Until they make it here, the choice the forecast plugin kept
 * stands, where it counted then: while that plugin was on.
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type * as PeerState from "../../../core/state/PeerState.ts";

const SharingData = Schema.Struct({ shareWork: Schema.Boolean });
const isEarlierChoice = Schema.is(Schema.Struct({ shareWip: Schema.Boolean }));

export const workSharing = (state: PeerState.PeerState["Service"]) => {
  const data = state.pluginData("rooms", SharingData);
  return {
    on: Effect.gen(function* () {
      const chosen = yield* data.read;
      if (Option.isSome(chosen)) return chosen.value.shareWork;
      const { persisted } = yield* state.read;
      const earlier = persisted.pluginData?.forecast;
      return isEarlierChoice(earlier) && earlier.shareWip && persisted.plugins?.forecast !== false;
    }),
    set: (shareWork: boolean) => data.update(() => ({ shareWork })).pipe(state.lock.withPermits(1)),
  };
};
