import { SLACK_OLDER_HUB_LINE, isSlackAdmin } from "@t3tools/client-runtime/peer/slack";
import type { EnvironmentId, PeerWorkspaceState } from "@t3tools/contracts";

import { useCopyToClipboard } from "../../../hooks/useCopyToClipboard";
import { useEnvironmentQuery } from "../../../state/query";
import { ConnectionStatus } from "../../settings/ConnectionStatus";
import { Alert, AlertAction, AlertDescription } from "../../ui/alert";
import { Button } from "../../ui/button";
import { PeerCard } from "../PeerPageHeader";
import { PersonAvatar } from "../settings/ProjectPeopleParts";
import { useOpenPeerSettings } from "../settings/peerSettingsLinks";
import { slackAtoms } from "./atoms";
import { SlackMember } from "./SlackMember";
import { slackMeView, slackSetupShare } from "./slack.logic";

/** What every member gets from Slack, which the page says before the workspace has connected it. */
const WHAT_EVERYONE_GETS = [
  "An agent that waits for you asks in Slack too.",
  "You answer in the Slack thread; the agent carries on.",
  "Each person picks what reaches them, here.",
] as const;

function OpenSetupButton({
  workspace,
  variant = "default",
}: {
  readonly workspace: string;
  readonly variant?: "default" | "warning-outline";
}) {
  const open = useOpenPeerSettings();
  return (
    <Button
      size="sm"
      variant={variant}
      onClick={() => void open({ kind: "workspace", workspace, section: "integrations" })}
    >
      Open Slack setup
    </Button>
  );
}

/** A member of a workspace without Slack asks the admins to connect it: a link, or where to look. */
function AskAdmins({
  workspace,
  admins,
}: {
  readonly workspace: PeerWorkspaceState;
  readonly admins: ReadonlyArray<string>;
}) {
  const share = slackSetupShare({ origin: window.location.origin, workspace });
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    timeout: 1_500,
    target: "the Slack setup",
  });
  return (
    <>
      {admins.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ask an admin of {workspace.name}.</p>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3">
          <span className="text-xs text-muted-foreground">Admins</span>
          {admins.map((name) => (
            <span key={name} className="flex items-center gap-2 text-sm text-foreground">
              <PersonAvatar name={name} size="sm" />
              {name}
            </span>
          ))}
        </div>
      )}
      <div>
        <Button size="sm" variant="outline" onClick={() => copyToClipboard(share.text, undefined)}>
          {isCopied ? "Copied" : share.label}
        </Button>
      </div>
      <span className="text-xs text-muted-foreground">
        Until then, agents ask you only in Peer.
      </span>
    </>
  );
}

/**
 * Me › Slack for one workspace (design artboard 4d), under the page’s one heading. Before the
 * workspace has connected Slack an admin gets the way to the setup and a member gets the admins’
 * names; the page is there either way. Once it is connected everyone has their account and their
 * options. Reads from the Hub when it opens and again after each action.
 */
export function SlackMePage({
  environmentId,
  workspace,
  admins,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: PeerWorkspaceState;
  /** The workspace’s admins by name, for a member to ask; empty where the Hub does not say. */
  readonly admins: ReadonlyArray<string>;
}) {
  const input = { workspace: workspace.slug };
  const me = useEnvironmentQuery(slackAtoms.me({ environmentId, input }));
  const connection = useEnvironmentQuery(
    isSlackAdmin(workspace.role) ? slackAtoms.admin({ environmentId, input }) : null,
  );
  const view = slackMeView(workspace.role, { me, admin: connection }, admins);
  const refresh = () => {
    me.refresh();
    connection.refresh();
  };
  switch (view.kind) {
    case "loading":
      return (
        <p role="status" className="text-sm text-muted-foreground">
          Loading Slack…
        </p>
      );
    case "older-hub":
      return <p className="text-sm text-muted-foreground">{SLACK_OLDER_HUB_LINE}</p>;
    case "error":
      return (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm text-destructive-foreground">
            {view.message}
          </p>
          <Button variant="outline" size="sm" onClick={refresh}>
            Retry
          </Button>
        </div>
      );
    case "admin-setup":
      return (
        <PeerCard aria-label="Slack setup">
          {view.status === null ? null : <ConnectionStatus {...view.status} />}
          <p className="text-sm text-foreground">
            {workspace.name} hasn’t connected Slack yet. You’re an admin, so you can: it takes about
            4 minutes, once for everybody.
          </p>
          <div>
            <OpenSetupButton workspace={workspace.slug} />
          </div>
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <span className="text-sm font-semibold text-foreground">What everyone gets</span>
            <ul className="list-disc ps-5 text-sm text-muted-foreground">
              {WHAT_EVERYONE_GETS.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </PeerCard>
      );
    case "member-waiting":
      return (
        <PeerCard aria-label="Slack not connected">
          <p className="text-sm text-foreground">
            {workspace.name} hasn’t connected Slack yet. An admin connects it once for everybody.
          </p>
          <AskAdmins workspace={workspace} admins={view.admins} />
        </PeerCard>
      );
    case "options":
      return (
        <div className="flex flex-col gap-3">
          {view.notice === null ? null : (
            <Alert variant="warning" role="status">
              <AlertDescription>{view.notice}</AlertDescription>
              <AlertAction>
                <OpenSetupButton workspace={workspace.slug} variant="warning-outline" />
              </AlertAction>
            </Alert>
          )}
          <SlackMember
            environmentId={environmentId}
            workspace={workspace.slug}
            account={view.account}
            options={view.options}
            refresh={refresh}
          />
        </div>
      );
  }
}
