import { useRef, useState, type ReactNode } from "react";

import { useAtomCommand } from "../../../state/use-atom-command";
import { Button, InlineButton } from "../../ui/button";
import { slackAtoms } from "./atoms";
import { SlackLinkButton, SlackSecretFields } from "./SlackApp";
import { SlackCode, SlackCopyButton, SlackStepMark } from "./SlackParts";
import { SlackScopes } from "./SlackScopes";
import { SlackVerifyResult } from "./SlackVerifyResult";
import {
  SLACK_APPS_URL,
  hintConfirmed,
  slackExistingFacts,
  slackVerifyPlan,
  slackVerifyResult,
} from "./slackSteps.logic";
import type { SlackBodyProps } from "./SlackStepBodies";

type ExistingProps = Pick<
  SlackBodyProps,
  "environmentId" | "workspace" | "admin" | "hints" | "changeHints" | "busy" | "run"
> & {
  /** Back to the two ways in. */
  readonly onLeave: () => void;
  /** The admin accepted the Slack workspace: on to where agents post. */
  readonly onContinue: () => void;
};

function Item({
  n,
  title,
  children,
}: {
  readonly n: number;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <li className="flex gap-3 rounded-xl border border-border bg-card p-4">
      <SlackStepMark n={n} state="later" />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <b className="text-sm font-semibold text-foreground">{title}</b>
        {children}
      </div>
    </li>
  );
}

/**
 * Connecting an app the team already made (design artboard 4c), on one page: find the app, check
 * that it calls this Hub on the right addresses, copy its two values, and save and verify them. Peer
 * changes nothing in Slack; what Verify finds is shown before anything is used.
 */
export function SlackExisting({
  environmentId,
  workspace,
  admin,
  hints,
  changeHints,
  busy,
  run,
  onLeave,
  onContinue,
}: ExistingProps) {
  const save = useAtomCommand(slackAtoms.saveSecrets, { reportFailure: false });
  const verify = useAtomCommand(slackAtoms.verify, { reportFailure: false });
  const [botToken, setBotToken] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const botTokenRef = useRef<HTMLInputElement>(null);
  const facts = slackExistingFacts(admin, workspace.slug);
  const plan = slackVerifyPlan(admin, workspace.slug, { botToken, signingSecret });
  const result = slackVerifyResult(admin, workspace, hints);

  const submit = () => {
    if (busy || plan.kind !== "run") return;
    const { save: input } = plan;
    void run(async () => {
      if (input !== null) {
        const saved = await save({ environmentId, input });
        if (saved._tag === "Failure") return saved;
      }
      return verify({ environmentId, input: { workspace: workspace.slug } });
    }).then((done) => {
      if (!done) return;
      setBotToken("");
      setSigningSecret("");
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <InlineButton className="self-start" tone="muted" onClick={onLeave}>
          ‹ Other ways to connect
        </InlineButton>
        <h3 className="text-sm font-semibold text-foreground">Connect an existing Slack app</h3>
        <p className="text-sm text-muted-foreground">
          For an app your team already made for Peer. Nothing changes in Slack unless you change it
          there.
        </p>
      </div>
      <ol className="flex flex-col gap-2.5">
        <Item n={1} title="Find the app">
          <p className="text-sm text-foreground">
            Open your Slack apps and pick the app made for Peer, usually named Peer and installed in{" "}
            {workspace.name}.
          </p>
          <SlackLinkButton url={SLACK_APPS_URL}>Open api.slack.com/apps</SlackLinkButton>
        </Item>
        <Item n={2} title="Check that it talks to this Hub">
          {facts.urls.map((address) => (
            <div key={address.id} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{address.where}</span>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs text-foreground select-all">
                  {address.url}
                </code>
                <SlackCopyButton label={address.where} value={address.url} />
              </div>
            </div>
          ))}
          <p className="text-sm text-muted-foreground">
            Bot events:{" "}
            {facts.botEvents.map((event, index) => (
              <span key={event}>
                {index === 0 ? "" : " · "}
                <SlackCode>{event}</SlackCode>
              </span>
            ))}
            . Scopes: {facts.scopeCount}, the same as a new app (see “What the app may do”). Missing
            one? Add it under OAuth &amp; Permissions and reinstall the app.
          </p>
          <SlackScopes />
        </Item>
        <Item n={3} title="Copy two values">
          <SlackSecretFields
            secrets={admin.secrets}
            botToken={botToken}
            signingSecret={signingSecret}
            disabled={busy}
            onBotToken={setBotToken}
            onSigningSecret={setSigningSecret}
            botTokenRef={botTokenRef}
          />
        </Item>
        <Item n={4} title="Save and verify">
          <p className="text-sm text-foreground">
            Peer stores both in the Hub’s secrets and asks Slack whose they are. Nothing is used
            before you confirm.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy || plan.kind !== "run"} onClick={submit}>
              {plan.kind === "run" ? plan.label : "Save and verify"}
            </Button>
            {plan.kind === "blocked" ? (
              <span className="text-xs text-muted-foreground">{plan.reason}</span>
            ) : null}
          </div>
          <SlackVerifyResult
            result={result}
            workspaceName={workspace.name}
            title="This is the app Peer will use"
            busy={busy}
            onContinue={() => {
              if (result.kind !== "verified") return;
              const team = result.team.id;
              changeHints((kept) => hintConfirmed(kept, team));
              onContinue();
            }}
            onPasteOther={() => botTokenRef.current?.focus()}
          />
        </Item>
      </ol>
    </div>
  );
}
