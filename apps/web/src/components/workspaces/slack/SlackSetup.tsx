import type { EnvironmentId, PeerSlackChannels, PeerWorkspaceState } from "@t3tools/contracts";
import { slackActivityRows } from "@t3tools/client-runtime/peer/slack";

import { ensureLocalApi } from "../../../localApi";
import type { EnvironmentQueryView } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { slackAtoms } from "./atoms";
import { SlackCreateApp, SlackSecrets } from "./SlackApp";
import { SlackChannels } from "./SlackChannels";
import { SlackFeedback, SlackRow } from "./SlackRow";
import {
  SLACK_DISCONNECTED,
  slackDisconnectConfirmation,
  slackTestBlocker,
  slackTestQueued,
  type SlackSetupView,
} from "./slack.logic";
import { useSlackRun } from "./useSlackRun";

/**
 * An owner's or admin's Slack setup, step by step: create the app from Peer's manifest, store its
 * token and signing secret, verify them with Slack, choose where agents post. Once connected it
 * shows the connection's health, with Test and Disconnect.
 */
export function SlackSetup({
  environmentId,
  workspace,
  view,
  channels,
  refresh,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: PeerWorkspaceState;
  readonly view: SlackSetupView;
  readonly channels: EnvironmentQueryView<PeerSlackChannels>;
  readonly refresh: () => void;
}) {
  const { busy, message, error, run } = useSlackRun(refresh);
  const verify = useAtomCommand(slackAtoms.verify, { reportFailure: false });
  const test = useAtomCommand(slackAtoms.test, { reportFailure: false });
  const disconnect = useAtomCommand(slackAtoms.disconnect, { reportFailure: false });
  const { admin, blocks } = view;
  const input = { workspace: workspace.slug };
  const blocker = slackTestBlocker(admin);
  return (
    <>
      <SlackRow
        title="Connection"
        description={view.summary}
        control={<Badge variant={view.tone}>{view.stateLabel}</Badge>}
      >
        {view.problems.length === 0 ? null : (
          <ul className="flex flex-col gap-1 pb-3 pl-4 text-sm text-destructive">
            {view.problems.map((problem) => (
              <li key={problem.code}>{problem.sentence}</li>
            ))}
          </ul>
        )}
      </SlackRow>
      {blocks.create ? <SlackCreateApp hubUrl={admin.hubUrl} workspace={workspace.slug} /> : null}
      {blocks.secrets ? (
        <SlackSecrets
          environmentId={environmentId}
          workspace={workspace.slug}
          secrets={admin.secrets}
          busy={busy}
          run={run}
        />
      ) : null}
      {blocks.verify ? (
        <SlackRow
          title="Verify"
          description="Peer checks the bot token and signing secret with Slack."
          control={
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void run(() => verify({ environmentId, input }))}
            >
              Verify
            </Button>
          }
        />
      ) : null}
      {blocks.channels ? (
        <SlackChannels
          environmentId={environmentId}
          workspace={workspace.slug}
          admin={admin}
          channels={channels}
          busy={busy}
          run={run}
        />
      ) : null}
      {blocks.health ? (
        <SlackRow
          title="Health"
          description={blocker ?? undefined}
          control={
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || blocker !== null}
                onClick={() =>
                  void run(() => test({ environmentId, input }), slackTestQueued(admin))
                }
              >
                Test
              </Button>
              <Button
                variant="destructive-outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    if (
                      !(await ensureLocalApi().dialogs.confirm(
                        slackDisconnectConfirmation(workspace.name),
                      ))
                    )
                      return;
                    await run(() => disconnect({ environmentId, input }), SLACK_DISCONNECTED);
                  })();
                }}
              >
                Disconnect
              </Button>
            </div>
          }
        >
          <dl className="flex flex-wrap gap-x-8 gap-y-2 pb-3 pl-4">
            {slackActivityRows(admin).map((row) => (
              <div key={row.label}>
                <dt className="text-xs text-muted-foreground">{row.label}</dt>
                <dd className="text-sm">{row.value}</dd>
              </div>
            ))}
          </dl>
        </SlackRow>
      ) : null}
      <SlackFeedback message={message} error={error} />
    </>
  );
}
