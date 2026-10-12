import { slackActivityRows } from "@t3tools/client-runtime/peer/slack";
import type { EnvironmentId, PeerWorkspaceState } from "@t3tools/contracts";
import { useState } from "react";

import { ensureLocalApi } from "../../../localApi";
import { useEnvironmentQuery } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import { SettingsSection } from "../../settings/settingsLayout";
import { Button, InlineButton } from "../../ui/button";
import { slackAtoms } from "../slack/atoms";
import { SlackChannels } from "../slack/SlackChannels";
import { SlackFeedback, SlackRow } from "../slack/SlackRow";
import {
  SLACK_DISCONNECTED,
  slackDisconnectConfirmation,
  slackPlaceRows,
  slackTestBlocker,
  slackTestQueued,
} from "../slack/slack.logic";
import { useSlackRun } from "../slack/useSlackRun";
import { linkedText, memberDisconnected, type SlackCardState } from "./integrations.logic";
import { PersonAvatar } from "./ProjectPeopleParts";

type Connected = Extract<SlackCardState, { readonly kind: "connected" }>;

/**
 * Slack once it is connected: where agents post (the default channel and the projects that differ),
 * who linked their Slack account with a Disconnect for each, and Disconnect for the workspace. The
 * channel pickers, the test post and the health stay behind Change.
 */
export function SlackConnected({
  environmentId,
  workspace,
  state,
  refresh,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: PeerWorkspaceState;
  readonly state: Connected;
  readonly refresh: () => void;
}) {
  const { admin } = state;
  const input = { workspace: workspace.slug };
  const { busy, message, error, run } = useSlackRun(refresh);
  const unlinkMember = useAtomCommand(slackAtoms.unlinkMember, { reportFailure: false });
  const disconnect = useAtomCommand(slackAtoms.disconnect, { reportFailure: false });
  const test = useAtomCommand(slackAtoms.test, { reportFailure: false });
  const [editing, setEditing] = useState(false);
  // Slack lists channels when the pickers are showing.
  const channels = useEnvironmentQuery(
    editing ? slackAtoms.channels({ environmentId, input }) : null,
  );
  const blocker = slackTestBlocker(admin);

  const disconnectSlack = async () => {
    const yes = await ensureLocalApi().dialogs.confirm(slackDisconnectConfirmation(workspace.name));
    if (!yes) return;
    await run(() => disconnect({ environmentId, input }), SLACK_DISCONNECTED);
  };

  return (
    <>
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {slackPlaceRows(admin).map((row) => (
          <div key={row.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <span className="min-w-0 flex-1 text-sm text-foreground">{row.label}</span>
            <span className="text-sm text-muted-foreground">{row.value}</span>
            <InlineButton
              tone="muted"
              aria-label={`Change ${row.label}`}
              aria-expanded={editing}
              onClick={() => setEditing(true)}
            >
              Change
            </InlineButton>
            {row.problem === null ? null : (
              <span className="basis-full text-xs text-destructive-foreground">{row.problem}</span>
            )}
          </div>
        ))}
      </div>
      {state.members.length === 0 ? (
        <p className="text-sm text-muted-foreground">{linkedText(state.linked)}</p>
      ) : (
        <ul
          aria-label="Members with a Slack account linked"
          className="flex flex-col divide-y divide-border rounded-lg border border-border"
        >
          {state.members.map((member) => (
            <li key={member.email} className="flex items-center gap-2.5 px-3 py-2">
              <PersonAvatar name={member.name} />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {member.name}{" "}
                <span className="text-muted-foreground">
                  {member.handle}
                  {member.you ? " · you" : ""}
                </span>
              </span>
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                aria-label={`Disconnect ${member.name}`}
                onClick={() =>
                  void run(
                    () => unlinkMember({ environmentId, input: { ...input, email: member.email } }),
                    memberDisconnected(member.name),
                  )
                }
              >
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      )}
      <SlackFeedback message={message} error={error} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          size="sm"
          variant="ghost-destructive"
          disabled={busy}
          onClick={() => void disconnectSlack()}
        >
          Disconnect Slack from {workspace.name}…
        </Button>
        <Button
          size="sm"
          variant="ghost-muted"
          aria-expanded={editing}
          onClick={() => setEditing(!editing)}
        >
          {editing ? "Hide channels, test and health" : "Channels, test and health"}
        </Button>
      </div>
      {editing ? (
        <SettingsSection title="Slack channels, test and health" hideTitle>
          <SlackChannels
            environmentId={environmentId}
            workspace={workspace.slug}
            admin={admin}
            channels={channels}
            busy={busy}
            run={run}
          />
          <SlackRow
            title="Health"
            description={blocker ?? undefined}
            control={
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" disabled={busy} onClick={refresh}>
                  Refresh
                </Button>
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
              </div>
            }
          >
            <dl className="flex flex-wrap gap-x-8 gap-y-2 pb-3">
              {slackActivityRows(admin).map((row) => (
                <div key={row.label}>
                  <dt className="text-xs text-muted-foreground">{row.label}</dt>
                  <dd className="text-sm">{row.value}</dd>
                </div>
              ))}
            </dl>
          </SlackRow>
        </SettingsSection>
      ) : null}
    </>
  );
}
