import type { EnvironmentId, PeerSlackAdminResult } from "@t3tools/contracts";
import { slackCreateAppUrl, slackManifest } from "@t3tools/client-runtime/peer/slack";
import { useState } from "react";

import { ensureLocalApi } from "../../../localApi";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { slackAtoms } from "./atoms";
import { SlackRow } from "./SlackRow";
import { slackSecretsInput } from "./slack.logic";
import type { SlackRun } from "./useSlackRun";

/**
 * Slack's page for creating an app opens with this workspace's manifest filled in: the Hub's
 * addresses for Slack to call, the scopes Peer uses and Socket Mode off. The desktop app opens it
 * in the browser through its own external link opener.
 */
export function SlackCreateApp({
  hubUrl,
  workspace,
}: {
  readonly hubUrl: string;
  readonly workspace: string;
}) {
  const [failed, setFailed] = useState(false);
  const url = slackCreateAppUrl(slackManifest(hubUrl, workspace));
  return (
    <SlackRow
      title="Slack app"
      description="Slack opens with Peer's settings filled in. After you create the app, install it to your Slack workspace."
      control={
        <Button
          size="sm"
          onClick={() => {
            setFailed(false);
            void ensureLocalApi()
              .shell.openExternal(url)
              .catch(() => setFailed(true));
          }}
        >
          Create the Slack app
        </Button>
      }
    >
      {failed ? (
        <div className="flex flex-wrap items-center gap-2 pb-3 pl-4">
          <p role="alert" className="text-sm text-destructive">
            Could not open Slack. Copy the link and open it in a browser.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void navigator.clipboard?.writeText(url).catch(() => undefined)}
          >
            Copy link
          </Button>
        </div>
      ) : null}
    </SlackRow>
  );
}

function SecretField({
  label,
  placeholder,
  stored,
  value,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly placeholder: string;
  readonly stored: boolean;
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="flex items-center gap-2 font-medium">
        {label}
        <Badge variant={stored ? "success" : "outline"}>{stored ? "Stored" : "Missing"}</Badge>
      </span>
      <Input
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder={stored ? "Stored. Paste a new one to replace it." : placeholder}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

/**
 * The app's two secrets. Peer seals what is saved and never shows it again, only whether each is
 * stored; the fields empty once saved.
 */
export function SlackSecrets({
  environmentId,
  workspace,
  secrets,
  busy,
  run,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly secrets: PeerSlackAdminResult["secrets"];
  readonly busy: boolean;
  readonly run: SlackRun;
}) {
  const save = useAtomCommand(slackAtoms.saveSecrets, { reportFailure: false });
  const [botToken, setBotToken] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const parsed = slackSecretsInput(workspace, { botToken, signingSecret });
  return (
    <SlackRow
      title="Bot token and signing secret"
      description="From your Slack app: the Bot User OAuth Token (OAuth & Permissions) and the Signing Secret (Basic Information)."
    >
      <form
        className="flex max-w-md flex-col gap-3 pb-3 pl-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || parsed.kind !== "ready") return;
          void run(() => save({ environmentId, input: parsed.input }), "Stored.").then((saved) => {
            if (!saved) return;
            setBotToken("");
            setSigningSecret("");
          });
        }}
      >
        <SecretField
          label="Bot token"
          placeholder="xoxb-…"
          stored={secrets.botToken === "stored"}
          value={botToken}
          disabled={busy}
          onChange={setBotToken}
        />
        <SecretField
          label="Signing secret"
          placeholder="Signing secret"
          stored={secrets.signingSecret === "stored"}
          value={signingSecret}
          disabled={busy}
          onChange={setSigningSecret}
        />
        {parsed.kind === "invalid" ? (
          <p role="alert" className="text-xs text-destructive">
            {parsed.message}
          </p>
        ) : null}
        <div>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={busy || parsed.kind !== "ready"}
          >
            Save
          </Button>
        </div>
      </form>
    </SlackRow>
  );
}
