import * as Schema from "effect/Schema";

import { useLocalStorage } from "../../../hooks/useLocalStorage";
import { EMPTY_SLACK_HINTS, slackHintsKey, type SlackHints } from "./slackSteps.logic";

const StoredHints = Schema.NullOr(
  Schema.Struct({
    openedAt: Schema.NullOr(Schema.String),
    created: Schema.Boolean,
    ticks: Schema.Array(Schema.String),
    confirmedTeam: Schema.NullOr(Schema.String),
  }),
);

/**
 * What the admin did in Slack for this workspace, kept in this browser: when Peer opened Slack's
 * page, the ticks they gave, the Slack workspace they accepted. Hints only; the Hub's view decides
 * what is done, so a cleared browser costs the admin nothing but a step to tick again.
 */
export function useSlackHints(workspace: string) {
  const [stored, setStored] = useLocalStorage(slackHintsKey(workspace), null, StoredHints);
  const hints: SlackHints = stored ?? EMPTY_SLACK_HINTS;
  return {
    hints,
    change: (update: (current: SlackHints) => SlackHints) =>
      setStored((current) => update(current ?? EMPTY_SLACK_HINTS)),
    /** Forgets everything: the way back to the two ways in. */
    clear: () => setStored(null),
  };
}
