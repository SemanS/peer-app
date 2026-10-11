/**
 * The wizard that sets up GitHub's PR checks (design artboard 20): turn them on (the Hub stores a
 * secret and the workspace's `github` block), add the webhook in GitHub with what the Hub says, then
 * wait for GitHub's ping. A workspace with the checks on opens at the webhook, to see it again or to
 * rotate its secret. The secret is shown once, in the answer to turning on or to rotating.
 */
import type {
  EnvironmentId,
  PeerGitHubStatus,
  PeerSettingsGitHubSetup,
  PeerWorkspaceState,
} from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { useCopyToClipboard } from "../../../hooks/useCopyToClipboard";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { formatShortTimestamp } from "../../../timestampFormat";
import { Button } from "../../ui/button";
import { Dialog } from "../../ui/dialog";
import { WizardFooter, WizardHeader, WizardPanel, WizardPopup, WizardSteps } from "../../ui/wizard";
import { PeerDialogMessage } from "../PeerDialog";
import { failureMessage } from "../WorkspaceAccess";
import {
  POLL_MS,
  ROTATE_WARNING,
  TURN_ON_TEXT,
  WAITING_TEXT,
  WIZARD_STEPS,
  pingArrived,
  pingText,
  secretNote,
  secretShown,
  setupFields,
  startingStep,
  worksForText,
  type WizardStep,
} from "./githubWizard.logic";

function CopyButton({ label, value }: { readonly label: string; readonly value: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ timeout: 1_500, target: label });
  return (
    <Button
      size="xs"
      variant="outline"
      aria-label={`Copy ${label}`}
      onClick={() => copyToClipboard(value, undefined)}
    >
      {isCopied ? "Copied" : "Copy"}
    </Button>
  );
}

/** What to enter in GitHub, a row for each: where, how, with which secret, which events. */
function SetupFields({ setup }: { readonly setup: PeerSettingsGitHubSetup }) {
  return (
    <dl className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
      {setupFields(setup).map((field) => (
        <div
          key={field.label}
          className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-2"
        >
          <dt className="text-sm text-muted-foreground">{field.label}</dt>
          <dd
            className={
              field.sealed
                ? "min-w-0 truncate text-sm text-muted-foreground"
                : "min-w-0 truncate font-mono text-xs text-foreground select-all"
            }
          >
            {field.value}
          </dd>
          {field.copy ? <CopyButton label={field.label} value={field.value} /> : <span />}
        </div>
      ))}
    </dl>
  );
}

/**
 * The wizard's dialog. Each step is the person's to take: nothing moves on its own except the
 * waiting for the ping, which asks the Hub now and then until it came.
 */
export function GitHubWizard({
  environmentId,
  workspace,
  status,
  onChanged,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: PeerWorkspaceState;
  /** The checks' status when the wizard opened. */
  readonly status: PeerGitHubStatus;
  /** The checks changed (turned on, a secret rotated, a ping came): read the card's status again. */
  readonly onChanged: () => void;
  readonly onClose: () => void;
}) {
  const enable = useAtomCommand(serverEnvironment.peerSettings.githubEnable, {
    reportFailure: false,
  });
  const readStatus = useAtomCommand(serverEnvironment.peerGitHubStatus, { reportFailure: false });
  const input = { workspace: workspace.slug };
  const [step, setStep] = useState<WizardStep>(startingStep(status));
  const [setup, setSetup] = useState<PeerSettingsGitHubSetup | null>(null);
  const [latest, setLatest] = useState(status);
  const [baseline, setBaseline] = useState<string | null>(status.lastPingAt);
  const [pinged, setPinged] = useState(false);
  // A workspace with the checks on opens at the webhook, which the Hub is asked for as it opens.
  const [busy, setBusy] = useState(startingStep(status) === 1);
  const [checking, setChecking] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reading = useRef(false);

  /** Turns the checks on, or (without a new secret) asks again for what GitHub needs. */
  const request = async (rotate: boolean) => {
    try {
      const result = await enable({
        environmentId,
        input: { ...input, ...(rotate ? { rotate } : {}) },
      });
      const failure = failureMessage(result);
      setError(failure);
      if (failure !== null || result._tag !== "Success") return false;
      setSetup(result.value);
      onChanged();
      return true;
    } finally {
      setBusy(false);
    }
  };
  const ask = (rotate: boolean) => {
    setBusy(true);
    setError(null);
    return request(rotate);
  };

  const openAtTheWebhook = useEffectEvent(() => {
    if (step === 1 && setup === null) void request(false);
  });
  useEffect(() => {
    openAtTheWebhook();
  }, []);

  const check = async () => {
    if (reading.current) return;
    reading.current = true;
    setChecking(true);
    try {
      const result = await readStatus({ environmentId, input });
      if (result._tag !== "Success") return;
      setLatest(result.value);
      if (pingArrived(baseline, result.value)) {
        setPinged(true);
        onChanged();
      }
    } finally {
      reading.current = false;
      setChecking(false);
    }
  };

  // While the wizard waits for the ping it asks the Hub now and then, and stops once it came.
  const poll = useEffectEvent(() => {
    if (!document.hidden) void check();
  });
  useEffect(() => {
    if (step !== 2 || pinged) return undefined;
    const timer = setInterval(poll, POLL_MS);
    return () => clearInterval(timer);
  }, [step, pinged]);

  const rotate = async () => {
    setRotating(false);
    await ask(true);
  };

  const added = () => {
    setBaseline(latest.lastPingAt);
    setPinged(false);
    setStep(2);
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <WizardPopup>
        <WizardHeader title="GitHub PR checks">
          <WizardSteps steps={WIZARD_STEPS} currentStep={step} />
        </WizardHeader>
        <WizardPanel>
          {step === 0 ? (
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-foreground">{TURN_ON_TEXT}</p>
              <p className="text-muted-foreground">{worksForText(latest)}</p>
            </div>
          ) : null}
          {step === 1 ? (
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-foreground">
                In GitHub, add a webhook to your organization (Settings › Webhooks), or to each
                repository:
              </p>
              {setup === null ? (
                <div className="flex flex-col items-start gap-2">
                  <p role="status" className="text-muted-foreground">
                    {busy ? "Asking the Hub…" : "The Hub has not told what GitHub needs yet."}
                  </p>
                  {busy ? null : (
                    <Button size="xs" variant="outline" onClick={() => void ask(false)}>
                      Try again
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <SetupFields setup={setup} />
                  <p
                    className={
                      secretShown(setup)
                        ? "text-xs text-warning-foreground"
                        : "text-xs text-muted-foreground"
                    }
                  >
                    {secretNote(setup)}
                  </p>
                  {secretShown(setup) ? null : rotating ? (
                    <div className="flex flex-col items-start gap-2 rounded-lg border border-warning/32 bg-warning-surface p-3">
                      <p className="text-xs text-warning-foreground">{ROTATE_WARNING}</p>
                      <div className="flex items-center gap-2">
                        <Button
                          size="xs"
                          variant="destructive"
                          disabled={busy}
                          onClick={() => void rotate()}
                        >
                          {busy ? "Rotating…" : "Rotate and show the new secret"}
                        </Button>
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={busy}
                          onClick={() => setRotating(false)}
                        >
                          Keep the current one
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      size="xs"
                      variant="outline"
                      className="self-start"
                      disabled={busy}
                      onClick={() => setRotating(true)}
                    >
                      Rotate secret
                    </Button>
                  )}
                </>
              )}
            </div>
          ) : null}
          {step === 2 ? (
            <div className="flex flex-col gap-3 text-sm">
              {pinged && latest.lastPingAt !== null ? (
                <div
                  role="status"
                  className="flex items-center gap-2.5 rounded-lg border border-success/32 bg-success/4 p-3.5"
                >
                  <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-success" />
                  <span className="min-w-0 flex-1 text-foreground">
                    {pingText(workspace.slug, latest.lastPingAt, (at) =>
                      formatShortTimestamp(at, "locale"),
                    )}
                  </span>
                </div>
              ) : (
                <div
                  role="status"
                  className="flex items-center gap-2.5 rounded-lg border border-border bg-card p-3.5"
                >
                  <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-warning" />
                  <span className="min-w-0 flex-1 text-foreground">{WAITING_TEXT}</span>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={checking}
                    onClick={() => void check()}
                  >
                    {checking ? "Checking…" : "Check again"}
                  </Button>
                </div>
              )}
            </div>
          ) : null}
          {error === null ? null : <PeerDialogMessage tone="error">{error}</PeerDialogMessage>}
        </WizardPanel>
        <WizardFooter>
          {step === 0 ? (
            <>
              <Button variant="outline" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void ask(false).then((done) => {
                    if (done) setStep(1);
                  })
                }
              >
                {busy ? "Turning on…" : "Turn on and create a secret"}
              </Button>
            </>
          ) : null}
          {step === 1 ? (
            <Button disabled={busy || setup === null} onClick={added}>
              I’ve added it
            </Button>
          ) : null}
          {step === 2 ? (
            <>
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button variant={pinged ? "default" : "outline"} onClick={onClose}>
                Done
              </Button>
            </>
          ) : null}
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}
