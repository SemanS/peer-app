import { CircleCheckIcon, TriangleAlertIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "../../ui/alert";
import { Button, InlineButton } from "../../ui/button";
import type { SlackVerifyResult as VerifyResult } from "./slackSteps.logic";

/**
 * What Verify found out, before any channel is chosen: the Slack workspace and bot the values belong
 * to, with the way to go on once the admin knows it is the one they mean. A workspace that does not
 * look like theirs, or a token Slack refused, says what to do instead.
 */
export function SlackVerifyResult({
  result,
  workspaceName,
  title,
  busy,
  onContinue,
  onPasteOther,
}: {
  readonly result: VerifyResult;
  /** The Peer workspace, which the Slack workspace is compared with. */
  readonly workspaceName: string;
  /** What the box under a match is called. */
  readonly title: string;
  readonly busy: boolean;
  /** The admin accepts the Slack workspace and goes on to the channels. */
  readonly onContinue: () => void;
  /** The admin goes back to paste values of another app. */
  readonly onPasteOther: () => void;
}) {
  if (result.kind === "pending") return null;
  if (result.kind === "rejected") {
    return (
      <Alert variant="error">
        <AlertTitle>Slack rejected the token</AlertTitle>
        <AlertDescription>
          <span>{result.text}</span>
          <code className="font-mono text-xs">{result.code}</code>
        </AlertDescription>
      </Alert>
    );
  }
  const { team, bot } = result;
  const whose = (
    <span>
      Workspace <b className="font-semibold text-foreground">{team.name}</b>
      {bot === null ? null : (
        <>
          {" "}
          · bot <b className="font-semibold text-foreground">{bot}</b>
        </>
      )}
    </span>
  );
  if (result.confirmed) {
    return (
      <Alert variant="success" role="status">
        <CircleCheckIcon aria-hidden />
        <AlertDescription>{whose}</AlertDescription>
      </Alert>
    );
  }
  if (!result.looksRight) {
    return (
      <Alert variant="warning" role="status">
        <TriangleAlertIcon aria-hidden />
        <AlertTitle>These values belong to another workspace</AlertTitle>
        <AlertDescription>
          <span>
            Slack says: workspace <b className="font-semibold text-foreground">{team.name}</b>
            {bot === null ? "" : `, bot ${bot}`}. Peer finds people by their email, so most of{" "}
            {workspaceName} wouldn’t be found there.
          </span>
          <span className="text-xs">
            Use the app installed in {workspaceName}, or keep these if that’s really intended.
          </span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={onPasteOther}>
              Paste other values
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={onContinue}>
              Use {team.name} anyway
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="success" role="status">
      <CircleCheckIcon aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {whose}
        <span className="text-xs">
          Not {workspaceName}? The values come from another app or workspace:{" "}
          <InlineButton tone="muted" onClick={onPasteOther}>
            paste other values
          </InlineButton>
          .
        </span>
        <div>
          <Button size="sm" disabled={busy} onClick={onContinue}>
            Next: choose where agents post
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
