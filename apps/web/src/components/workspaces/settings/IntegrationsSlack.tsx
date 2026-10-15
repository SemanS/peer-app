/**
 * The Slack card of the Integrations page (design artboards 4a-4d). It says what Slack is for and how
 * it differs from webhooks, shows where the connection stands in the one status language, and
 * leads an admin through connecting: two ways in, the numbered steps, and Verify showing whose app it
 * is. Once connected, it says where agents post and who linked their account.
 */
import type { EnvironmentId, PeerWorkspaceState } from "@t3tools/contracts";
import { useState } from "react";

import { useEnvironmentQuery } from "../../../state/query";
import { ConnectionStatus } from "../../settings/ConnectionStatus";
import { Button } from "../../ui/button";
import { PeerCard } from "../PeerPageHeader";
import { slackAtoms } from "../slack/atoms";
import { SlackSetup } from "../slack/SlackSetup";
import { SLACK_PURPOSE, slackNeedsApp, slackStatusHints } from "../slack/slackSteps.logic";
import { useSlackHints } from "../slack/useSlackHints";
import { slackCardState, slackCardStatus } from "./integrations.logic";
import { SlackConnected } from "./IntegrationsSlackConnected";

export function SlackCard({
  environmentId,
  workspace,
  me,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: PeerWorkspaceState;
  /** The signed-in address, whose own row says "you". */
  readonly me: string | null;
}) {
  const input = { workspace: workspace.slug };
  const query = useEnvironmentQuery(slackAtoms.admin({ environmentId, input }));
  // What an admin does here changes every member's view too (Me › Slack, the Overview), which
  // Settings keeps open, so each action reads both again.
  const memberView = useEnvironmentQuery(slackAtoms.me({ environmentId, input }));
  const refresh = () => {
    query.refresh();
    memberView.refresh();
  };
  const state = slackCardState(query, me);
  const { hints } = useSlackHints(workspace.slug);
  // An admin who set Slack up here is told once that it is connected, instead of the card changing
  // under them: the card stays on the setup until they say they have read it.
  const [guided, setGuided] = useState(false);
  if (state.kind === "setup" && !guided) setGuided(true);
  return (
    <PeerCard aria-label="Slack conversations">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <h2 className="text-sm font-semibold text-foreground">Slack conversations</h2>
        <ConnectionStatus
          {...slackCardStatus(
            state,
            state.kind === "setup" || state.kind === "connected"
              ? slackStatusHints(state.admin, workspace, hints)
              : {},
          )}
          action={
            state.kind === "error" ? (
              <Button size="xs" variant="outline" onClick={query.refresh}>
                Try again
              </Button>
            ) : undefined
          }
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {SLACK_PURPOSE}
        {state.kind === "setup" ? ` ${slackNeedsApp(workspace.name)}` : ""}
      </p>
      {state.kind === "setup" || (state.kind === "connected" && guided) ? (
        <SlackSetup
          environmentId={environmentId}
          workspace={workspace}
          admin={state.admin}
          refresh={refresh}
          onDone={() => setGuided(false)}
        />
      ) : state.kind === "connected" ? (
        <SlackConnected
          environmentId={environmentId}
          workspace={workspace}
          state={state}
          refresh={refresh}
        />
      ) : null}
    </PeerCard>
  );
}
