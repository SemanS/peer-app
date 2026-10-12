import type { EnvironmentId, PeerSlackAdminResult } from "@t3tools/contracts";
import { useState } from "react";

import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { slackAtoms } from "./atoms";
import { SlackSecretFields } from "./SlackApp";
import { SlackRow } from "./SlackRow";
import { slackSecretsInput } from "./slack.logic";
import type { SlackRun } from "./useSlackRun";

/**
 * Replaces the app’s bot token or signing secret once Slack is connected, for a token rotated in
 * Slack: the new values are stored and verified again at once, so a wrong one shows as a problem
 * now and not when an agent next waits.
 */
export function SlackReplaceValues({
  environmentId,
  workspace,
  admin,
  busy,
  run,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly admin: PeerSlackAdminResult;
  readonly busy: boolean;
  readonly run: SlackRun;
}) {
  const save = useAtomCommand(slackAtoms.saveSecrets, { reportFailure: false });
  const verify = useAtomCommand(slackAtoms.verify, { reportFailure: false });
  const [botToken, setBotToken] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const parsed = slackSecretsInput(workspace, { botToken, signingSecret });
  return (
    <SlackRow
      title="Bot token and signing secret"
      description="Stored and sealed; Peer never shows them. Paste new ones after you rotate them in Slack, and Peer verifies them again."
    >
      <form
        className="flex flex-col gap-3 pb-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || parsed.kind !== "ready") return;
          const { input } = parsed;
          void run(async () => {
            const saved = await save({ environmentId, input });
            if (saved._tag === "Failure") return saved;
            return verify({ environmentId, input: { workspace } });
          }, "Stored and verified.").then((done) => {
            if (!done) return;
            setBotToken("");
            setSigningSecret("");
          });
        }}
      >
        <SlackSecretFields
          secrets={admin.secrets}
          botToken={botToken}
          signingSecret={signingSecret}
          disabled={busy}
          onBotToken={setBotToken}
          onSigningSecret={setSigningSecret}
        />
        {parsed.kind === "invalid" ? (
          <p role="alert" className="text-xs text-destructive-foreground">
            {parsed.message}
          </p>
        ) : null}
        <div>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={busy || parsed.kind !== "ready"}
          >
            Save and verify
          </Button>
        </div>
      </form>
    </SlackRow>
  );
}
