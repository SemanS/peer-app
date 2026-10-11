/**
 * The Slack card of the Integrations page (design artboard 19). Connected, it says to which Slack
 * workspace, lists the members who linked their account with a Disconnect for each, and offers to
 * disconnect Slack from the workspace. Not connected, the setup that has always led an admin through
 * it stands in the card's place; once connected, the channels, the test post and the health stay
 * behind "Channels, test and health".
 */
import { SLACK_OLDER_HUB_LINE } from "@t3tools/client-runtime/peer/slack";
import type { EnvironmentId, PeerWorkspaceState } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import { ensureLocalApi } from "../../../localApi";
import { useEnvironmentQuery } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import { SettingsSection } from "../../settings/settingsLayout";
import { Badge } from "../../ui/badge";
import { Button, InlineButton } from "../../ui/button";
import { PeerCard } from "../PeerPageHeader";
import { slackAtoms } from "../slack/atoms";
import { WorkspaceSlack } from "../slack/SlackSection";
import { SLACK_DISCONNECTED, slackDisconnectConfirmation } from "../slack/slack.logic";
import { useSlackRun } from "../slack/useSlackRun";
import { linkedText, memberDisconnected, slackCardState } from "./integrations.logic";
import { PersonAvatar } from "./ProjectPeopleParts";

function Heading({ children }: { readonly children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <h2 className="text-sm font-semibold text-foreground">Slack</h2>
      {children}
    </div>
  );
}

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
  const { busy, message, error, run } = useSlackRun(query.refresh);
  const unlinkMember = useAtomCommand(slackAtoms.unlinkMember, { reportFailure: false });
  const disconnect = useAtomCommand(slackAtoms.disconnect, { reportFailure: false });
  const [channels, setChannels] = useState(false);
  const state = slackCardState(query, me);

  if (state.kind === "setup") {
    return (
      <SettingsSection title="Slack" hideTitle>
        <WorkspaceSlack
          environmentId={environmentId}
          workspace={workspace}
          part="setup"
          defaultOpen
        />
      </SettingsSection>
    );
  }
  if (state.kind !== "connected") {
    return (
      <PeerCard aria-label="Slack">
        <Heading />
        {state.kind === "loading" ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading Slack…
          </p>
        ) : state.kind === "older-hub" ? (
          <p className="text-sm text-muted-foreground">{SLACK_OLDER_HUB_LINE}</p>
        ) : (
          <p role="alert" className="text-sm text-destructive-foreground">
            {state.message}{" "}
            <InlineButton tone="muted" onClick={query.refresh}>
              Try again
            </InlineButton>
          </p>
        )}
      </PeerCard>
    );
  }

  const disconnectSlack = async () => {
    const yes = await ensureLocalApi().dialogs.confirm(slackDisconnectConfirmation(workspace.name));
    if (!yes) return;
    await run(() => disconnect({ environmentId, input }), SLACK_DISCONNECTED);
  };

  return (
    <>
      <PeerCard aria-label="Slack">
        <Heading>
          <Badge variant="success" size="lg">
            Connected
          </Badge>
          <span className="text-xs text-muted-foreground">{state.team}</span>
        </Heading>
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
                      () =>
                        unlinkMember({
                          environmentId,
                          input: { ...input, email: member.email },
                        }),
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
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive-foreground">
            {error}
          </p>
        )}
        {message === null ? null : (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        )}
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
            aria-expanded={channels}
            onClick={() => setChannels(!channels)}
          >
            {channels ? "Hide channels, test and health" : "Channels, test and health"}
          </Button>
        </div>
      </PeerCard>
      {channels ? (
        <SettingsSection title="Slack channels, test and health" hideTitle>
          <WorkspaceSlack
            environmentId={environmentId}
            workspace={workspace}
            part="setup"
            defaultOpen
          />
        </SettingsSection>
      ) : null}
    </>
  );
}
