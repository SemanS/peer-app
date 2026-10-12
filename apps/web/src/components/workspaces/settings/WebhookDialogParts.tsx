/**
 * The parts of the webhook dialog (design artboard 21) that are not its frame: a line of what is
 * wrong, the destination with the secret that holds it, the signing of a generic webhook with the
 * key it signs with, and what a generic webhook is sent. They show and edit the dialog's draft; the
 * dialog stores and saves it.
 */
import type { ReactNode } from "react";

import { useCopyToClipboard } from "../../../hooks/useCopyToClipboard";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Switch } from "../../ui/switch";
import {
  PAYLOAD_NOTE,
  SIGNATURE_HEADERS,
  URL_HINT,
  formatCopy,
  generateSigningKey,
  genericPayloadSample,
  signingText,
  urlSecretOf,
  type WebhookDraft,
} from "./webhookForm.logic";

/** A line of what is wrong, under the field it is about. */
export function Problem({ children }: { readonly children: string | null }) {
  return children === null ? null : (
    <p role="alert" className="text-xs text-destructive-foreground">
      {children}
    </p>
  );
}

/** Where a stored secret stands: a green dot where it is, an amber one where it is not yet. */
function StoredLine({
  name,
  stored,
  action,
}: {
  readonly name: string;
  readonly stored: boolean;
  readonly action: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-1.5">
      <span
        aria-hidden
        className={
          stored
            ? "size-2 shrink-0 rounded-full bg-success"
            : "size-2 shrink-0 rounded-full bg-warning"
        }
      />
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        {stored ? "Stored as " : "Not stored yet: "}
        <span className="font-mono text-xs text-foreground">{name}</span>
      </span>
      {action}
    </div>
  );
}

/**
 * The destination: the secret that holds it when there is one, with Replace, else a field for the
 * address, with an example and where to get one for the webhook's format. Either way the hint says
 * it is saved as a secret and never shown again.
 */
export function Destination({
  draft,
  stored,
  fieldId,
  problem,
  onChange,
}: {
  readonly draft: WebhookDraft;
  readonly stored: ReadonlySet<string>;
  readonly fieldId: string;
  readonly problem: string | null;
  readonly onChange: (next: WebhookDraft) => void;
}) {
  const typing = draft.newUrl !== null;
  const saved = draft.urlSecret;
  const copy = formatCopy(draft.format);
  const helpId = `${fieldId}-help`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-medium text-foreground">
        Destination URL
      </label>
      {typing ? (
        <div className="flex items-center gap-2">
          <Input
            id={fieldId}
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            font="mono"
            placeholder={copy.urlPlaceholder}
            aria-invalid={problem !== null}
            aria-describedby={copy.urlHelp === null ? undefined : helpId}
            value={draft.newUrl ?? ""}
            onChange={(event) => onChange({ ...draft, newUrl: event.target.value })}
          />
          {saved === null ? null : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onChange({ ...draft, newUrl: null })}
            >
              Keep
            </Button>
          )}
        </div>
      ) : (
        <StoredLine
          name={saved ?? urlSecretOf(draft)}
          stored={stored.has(saved ?? "")}
          action={
            <Button
              size="xs"
              variant="outline"
              id={fieldId}
              onClick={() => onChange({ ...draft, newUrl: "" })}
            >
              {stored.has(saved ?? "") ? "Replace" : "Set value"}
            </Button>
          }
        />
      )}
      {typing && copy.urlHelp !== null ? (
        <p id={helpId} className="text-xs text-muted-foreground">
          {copy.urlHelp}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">{URL_HINT}</p>
      <Problem>{problem}</Problem>
    </div>
  );
}

/**
 * Whether the webhook signs, which a generic one always does (its receiver verifies the signature),
 * and the key it signs with: the secret that holds it, with Replace, or a field to type or generate
 * one in. A generated key is shown so it can be copied to the receiver; after saving it is not.
 */
export function Signing({
  draft,
  stored,
  fieldId,
  problem,
  onChange,
}: {
  readonly draft: WebhookDraft;
  readonly stored: ReadonlySet<string>;
  readonly fieldId: string;
  readonly problem: string | null;
  readonly onChange: (next: WebhookDraft) => void;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    timeout: 1_500,
    target: "signing key",
  });
  const typing = draft.newSigningKey !== null || draft.signingSecrets.length === 0;
  const rotating = draft.signingSecrets.length > 1;
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border p-3">
      <div className="flex items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium text-foreground">Sign each delivery</span>
          <span className="text-xs text-muted-foreground">
            {signingText(draft.signingSecrets, stored)}
          </span>
        </span>
        <Switch checked disabled aria-label="Sign each delivery" />
      </div>
      {rotating ? (
        <p className="text-xs text-muted-foreground">
          It signs with two keys while one is rotated out. Change them in the workspace’s YAML.
        </p>
      ) : typing ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={fieldId} className="text-xs text-muted-foreground">
            Signing key
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={fieldId}
              type="text"
              autoComplete="off"
              spellCheck={false}
              font="mono"
              placeholder="whsec_…"
              aria-invalid={problem !== null}
              value={draft.newSigningKey ?? ""}
              onChange={(event) => onChange({ ...draft, newSigningKey: event.target.value })}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => onChange({ ...draft, newSigningKey: generateSigningKey() })}
            >
              Generate
            </Button>
            {(draft.newSigningKey ?? "").trim() === "" ? null : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => copyToClipboard((draft.newSigningKey ?? "").trim(), undefined)}
              >
                {isCopied ? "Copied" : "Copy"}
              </Button>
            )}
            {draft.signingSecrets.length === 0 ? null : (
              <Button
                size="sm"
                variant="ghost-muted"
                onClick={() => onChange({ ...draft, newSigningKey: null })}
              >
                Keep
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Starts with whsec_. Saved as a secret, never shown again: copy it to the receiver now.
          </p>
          <Problem>{problem}</Problem>
        </div>
      ) : (
        <Button
          size="xs"
          variant="outline"
          className="self-start"
          onClick={() => onChange({ ...draft, newSigningKey: "" })}
        >
          Replace key
        </Button>
      )}
    </div>
  );
}

/**
 * What a generic webhook is sent: the headers a receiver verifies the signature with, and one
 * delivery as an example, so the receiver can be written before the first event arrives.
 */
export function PayloadSample({
  workspace,
  actor,
}: {
  readonly workspace: { readonly slug: string; readonly name: string };
  readonly actor: string;
}) {
  const [id, timestamp, signature] = SIGNATURE_HEADERS;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">
        Signed like Standard Webhooks: headers <code className="font-mono">{id}</code>,{" "}
        <code className="font-mono">{timestamp}</code> and{" "}
        <code className="font-mono">{signature}</code>. A Standard Webhooks library checks them in a
        few lines.
      </p>
      <span className="text-xs font-medium text-foreground">What Peer sends (POST, JSON)</span>
      <pre className="overflow-x-auto rounded-lg border border-border bg-background p-2.5 font-mono text-xs text-foreground">
        {genericPayloadSample({ workspace, actor })}
      </pre>
      <p className="text-xs text-muted-foreground">{PAYLOAD_NOTE}</p>
    </div>
  );
}
