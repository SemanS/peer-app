import type { PeerSlackAdminResult } from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { useState, type Ref } from "react";

import { useCopyToClipboard } from "../../../hooks/useCopyToClipboard";
import { ensureLocalApi } from "../../../localApi";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";

/** Opens an address in the browser (the desktop app uses its own external link opener). */
export function useOpenExternal() {
  const [failed, setFailed] = useState(false);
  return {
    failed,
    open: (url: string) => {
      setFailed(false);
      void ensureLocalApi()
        .shell.openExternal(url)
        .catch(() => setFailed(true));
    },
  };
}

/**
 * Opens Slack's page for creating an app with Peer's manifest filled in, or copies its link to open
 * elsewhere. Either way the admin leaves for Slack, which `onLeft` records.
 */
export function SlackOpenButtons({
  url,
  onLeft,
}: {
  readonly url: string;
  readonly onLeft: () => void;
}) {
  const { failed, open } = useOpenExternal();
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    timeout: 1_500,
    target: "Slack link",
  });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => {
            onLeft();
            open(url);
          }}
        >
          Open Slack
          <ExternalLinkIcon aria-hidden />
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            onLeft();
            copyToClipboard(url, undefined);
          }}
        >
          {isCopied ? "Copied" : "Copy link"}
        </Button>
      </div>
      {failed ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          Could not open Slack. Copy the link and open it in a browser.
        </p>
      ) : null}
    </div>
  );
}

/** A button that opens an address in the browser. */
export function SlackLinkButton({
  url,
  children,
}: {
  readonly url: string;
  readonly children: string;
}) {
  const { failed, open } = useOpenExternal();
  return (
    <div className="flex flex-col items-start gap-2">
      <Button size="sm" variant="outline" onClick={() => open(url)}>
        {children}
        <ExternalLinkIcon aria-hidden />
      </Button>
      {failed ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          Could not open the browser. Copy {url} and open it there.
        </p>
      ) : null}
    </div>
  );
}

function SecretField({
  label,
  help,
  placeholder,
  stored,
  value,
  disabled,
  onChange,
  inputRef,
}: {
  readonly label: string;
  readonly help: string;
  readonly placeholder: string;
  readonly stored: boolean;
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
  readonly inputRef?: Ref<HTMLInputElement>;
}) {
  const helpId = `slack-${label.replace(/\W+/g, "-").toLowerCase()}-help`;
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="flex items-center gap-2 font-medium">
        {label}
        <Badge variant={stored ? "success" : "outline"}>{stored ? "Stored" : "Missing"}</Badge>
      </span>
      <Input
        ref={inputRef}
        type="password"
        font="mono"
        autoComplete="off"
        spellCheck={false}
        aria-describedby={helpId}
        placeholder={stored ? "Stored. Paste a new one to replace it." : placeholder}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <span id={helpId} className="text-xs text-muted-foreground">
        {help}
      </span>
    </label>
  );
}

/**
 * The app's two values. Peer seals what is saved and never shows it again, only whether each is
 * stored; the fields empty once saved.
 */
export function SlackSecretFields({
  secrets,
  botToken,
  signingSecret,
  disabled,
  onBotToken,
  onSigningSecret,
  botTokenRef,
}: {
  readonly secrets: PeerSlackAdminResult["secrets"];
  readonly botToken: string;
  readonly signingSecret: string;
  readonly disabled: boolean;
  readonly onBotToken: (value: string) => void;
  readonly onSigningSecret: (value: string) => void;
  readonly botTokenRef?: Ref<HTMLInputElement>;
}) {
  return (
    <div className="flex max-w-lg flex-col gap-3">
      <SecretField
        label="Bot User OAuth Token"
        help="Slack › OAuth & Permissions › Bot User OAuth Token. Starts with xoxb-."
        placeholder="xoxb-…"
        stored={secrets.botToken === "stored"}
        value={botToken}
        disabled={disabled}
        onChange={onBotToken}
        {...(botTokenRef === undefined ? {} : { inputRef: botTokenRef })}
      />
      <SecretField
        label="Signing Secret"
        help="Slack › Basic Information › App Credentials › Signing Secret."
        placeholder="Signing secret"
        stored={secrets.signingSecret === "stored"}
        value={signingSecret}
        disabled={disabled}
        onChange={onSigningSecret}
      />
      <p className="text-xs text-muted-foreground">
        Both go to the Hub’s secrets, never into the workspace file.
      </p>
    </div>
  );
}
