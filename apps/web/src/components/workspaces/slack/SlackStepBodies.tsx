/**
 * What each of the four setup steps asks of the admin (design artboard 4b): create the app in Slack,
 * install it and copy two values, verify with Slack, choose where agents post. A step draws its own
 * content and its button; Back and Next, which walk the steps without changing anything, are the
 * stepper's and reach a body as `nav`.
 */
import type {
  EnvironmentId,
  PeerSlackAdminResult,
  PeerSlackChannels,
  PeerWorkspaceState,
} from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import type { EnvironmentQueryView } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { Checkbox } from "../../ui/checkbox";
import { slackAtoms } from "./atoms";
import { SlackOpenButtons, SlackSecretFields } from "./SlackApp";
import { SlackCode } from "./SlackParts";
import { SlackPicker } from "./SlackPicker";
import { SlackScopes } from "./SlackScopes";
import { SlackVerifyResult } from "./SlackVerifyResult";
import {
  slackDefaultChange,
  slackDefaultItems,
  slackDefaultValue,
  slackSecretsInput,
} from "./slack.logic";
import {
  hintConfirmed,
  hintCreated,
  hintOpened,
  hintTicked,
  slackCreateFacts,
  slackSecretsLabel,
  slackVerifyResult,
  type SlackHints,
  type SlackTick,
} from "./slackSteps.logic";
import type { SlackRun } from "./useSlackRun";

/** How a step moves the stepper: keep it open, let it follow the Hub again, go back or on. */
export interface SlackNav {
  /** The admin left for Slack: keep the step open until they are back in this window. */
  readonly left: () => void;
  readonly release: () => void;
  readonly back: (() => void) | null;
  /** Set on a step the admin came back to; the step they were at is where Next leads. */
  readonly next: (() => void) | null;
}

export interface SlackBodyProps {
  readonly environmentId: EnvironmentId;
  readonly workspace: PeerWorkspaceState;
  readonly admin: PeerSlackAdminResult;
  readonly hints: SlackHints;
  readonly changeHints: (update: (hints: SlackHints) => SlackHints) => void;
  readonly busy: boolean;
  readonly run: SlackRun;
  readonly nav: SlackNav;
}

/** A step's button, with Back (and Next, on a step already done) beside it. */
function StepActions({ nav, children }: { readonly nav: SlackNav; readonly children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      {nav.next === null ? null : (
        <Button size="sm" variant="outline" onClick={nav.next}>
          Next
        </Button>
      )}
      {nav.back === null ? null : (
        <Button size="sm" variant="ghost" onClick={nav.back}>
          Back
        </Button>
      )}
    </div>
  );
}

function Tick({
  tick,
  hints,
  changeHints,
  children,
}: {
  readonly tick: SlackTick;
  readonly hints: SlackHints;
  readonly changeHints: SlackBodyProps["changeHints"];
  readonly children: ReactNode;
}) {
  return (
    <label className="flex min-h-8 cursor-pointer items-center gap-2.5 text-sm">
      <Checkbox
        checked={hints.ticks.includes(tick)}
        onCheckedChange={(checked) => changeHints((current) => hintTicked(current, tick, checked))}
      />
      <span>{children}</span>
    </label>
  );
}

/**
 * Step 1: Slack opens with Peer’s settings filled in. What happens there Peer cannot see, so the
 * admin ticks what they did, and "I’ve done this" is theirs to say; opening Slack is remembered, so
 * coming back opens the next step.
 */
export function StepCreate({ admin, workspace, hints, changeHints, nav }: SlackBodyProps) {
  const facts = slackCreateFacts(admin, workspace.slug);
  // A value stored in the Hub is as good as the admin’s word: the app exists.
  const created =
    hints.created ||
    admin.secrets.botToken === "stored" ||
    admin.secrets.signingSecret === "stored";
  return (
    <>
      <p className="text-sm text-foreground">
        Peer opens Slack’s “Create an app” page with everything filled in for{" "}
        <SlackCode>{facts.host}</SlackCode>.
      </p>
      <SlackOpenButtons
        url={facts.url}
        onLeft={() => {
          nav.left();
          changeHints((kept) => hintOpened(kept, new Date().toISOString()));
        }}
      />
      <div className="flex flex-col">
        <Tick tick="workspace" hints={hints} changeHints={changeHints}>
          In Slack’s dialog, pick the <b className="font-semibold">{workspace.name}</b> workspace
        </Tick>
        <Tick tick="permissions" hints={hints} changeHints={changeHints}>
          Check what the app may do (below), then click Create
        </Tick>
      </div>
      <SlackScopes />
      <StepActions nav={nav}>
        {created ? null : (
          <Button
            size="sm"
            onClick={() => {
              nav.release();
              changeHints((kept) => hintCreated(kept, true));
            }}
          >
            I’ve done this
          </Button>
        )}
      </StepActions>
    </>
  );
}

/** Step 2: install the app, then copy its bot token and signing secret here. */
export function StepSecrets({ environmentId, workspace, admin, busy, run, nav }: SlackBodyProps) {
  const save = useAtomCommand(slackAtoms.saveSecrets, { reportFailure: false });
  const [botToken, setBotToken] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const parsed = slackSecretsInput(workspace.slug, { botToken, signingSecret });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || parsed.kind !== "ready") return;
        void run(() => save({ environmentId, input: parsed.input }), "Stored.").then((saved) => {
          if (!saved) return;
          setBotToken("");
          setSigningSecret("");
          nav.release();
        });
      }}
    >
      <p className="text-sm text-foreground">
        In Slack open <b className="font-semibold">Install App</b> →{" "}
        <b className="font-semibold">Install to {workspace.name}</b> →{" "}
        <b className="font-semibold">Allow</b>. Then copy these two values here.
      </p>
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
      <StepActions nav={nav}>
        <Button type="submit" size="sm" disabled={busy || parsed.kind !== "ready"}>
          {slackSecretsLabel({ botToken, signingSecret })}
        </Button>
      </StepActions>
    </form>
  );
}

/** Step 3: Peer asks Slack whose the values are and shows the answer before anything is used. */
export function StepVerify({
  environmentId,
  workspace,
  admin,
  hints,
  changeHints,
  busy,
  run,
  nav,
}: SlackBodyProps) {
  const verify = useAtomCommand(slackAtoms.verify, { reportFailure: false });
  const result = slackVerifyResult(admin, workspace, hints);
  return (
    <>
      <p className="text-sm text-foreground">Peer asks Slack who these values belong to.</p>
      <SlackVerifyResult
        result={result}
        workspaceName={workspace.name}
        title="Slack knows these values"
        busy={busy}
        onContinue={() => {
          if (result.kind !== "verified") return;
          const team = result.team.id;
          nav.release();
          changeHints((kept) => hintConfirmed(kept, team));
        }}
        onPasteOther={() => {
          nav.back?.();
        }}
      />
      <StepActions nav={nav}>
        <Button
          size="sm"
          variant={result.kind === "verified" && !result.confirmed ? "outline" : "default"}
          disabled={busy}
          onClick={() =>
            void run(() => verify({ environmentId, input: { workspace: workspace.slug } }))
          }
        >
          {result.kind === "pending" ? "Verify" : "Verify again"}
        </Button>
      </StepActions>
    </>
  );
}

/**
 * Step 4: the default channel for projects without one of their own, or direct messages only. Picking
 * one saves it, and with it the setup is done; a project’s own channel comes later.
 */
export function StepChannels({
  environmentId,
  workspace,
  admin,
  busy,
  run,
  nav,
  channels,
}: SlackBodyProps & { readonly channels: EnvironmentQueryView<PeerSlackChannels> }) {
  const setChannels = useAtomCommand(slackAtoms.setChannels, { reportFailure: false });
  const listed = channels.data?.channels ?? [];
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Default channel</span>
        <SlackPicker
          label="Default channel"
          value={slackDefaultValue(admin)}
          items={slackDefaultItems(listed, admin)}
          disabled={busy || channels.data === null}
          onChange={(value) =>
            void run(
              () =>
                setChannels({
                  environmentId,
                  input: { workspace: workspace.slug, ...slackDefaultChange(admin, value) },
                }),
              "Saved.",
            )
          }
        />
        <span className="text-xs text-muted-foreground">
          Where agents post for projects without a channel of their own. Peer joins it.
        </span>
        {channels.error !== null ? (
          <span className="flex flex-wrap items-center gap-2 text-sm text-destructive-foreground">
            Could not load Slack’s channels: {channels.error}
            <Button size="xs" variant="outline" onClick={channels.refresh}>
              Retry
            </Button>
          </span>
        ) : channels.data === null ? (
          <span role="status" className="text-xs text-muted-foreground">
            Loading Slack’s channels…
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Projects can get their own channel later, on this page. Each person chooses what reaches
        them in Me › Slack.
      </p>
      <StepActions nav={nav} />
    </>
  );
}
