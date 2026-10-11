import { herdrRuntimeLabel } from "@t3tools/client-runtime/peer/herdr";
import type { PeerHerdrIntegration } from "@t3tools/contracts";
import { useState } from "react";

import { useCopyToClipboard } from "../../../hooks/useCopyToClipboard";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { SettingsRow } from "../../settings/settingsLayout";
import { Button } from "../../ui/button";
import { stackedThreadToast, toastManager } from "../../ui/toast";
import type { PeerSlotProps } from "../slots.types";
import { usePeerPluginControl } from "../usePeerPluginControl";
import { confirmed, reportFailure } from "../workFeedback";
import {
  herdrIntegrationRow,
  herdrRuntimeActions,
  integrationConfirmation,
  otherRunningLine,
  pendingUpgradeLine,
  restartConfirmation,
  runtimeDetailLine,
  turnOffConfirmation,
  type HerdrConfirmation,
} from "./HerdrRuntimeSettings.logic";
import { useIsLocalDesktop } from "./localDesktop";

/**
 * Settings → Peer → Coordination & plugins: which herdr this environment's agents run in (the person's own or the one
 * Peer bundles), Peer's herdr turned off, on or restarted, a terminal attached to it, and the
 * integrations that let herdr resume agents after a restart.
 */
export function HerdrRuntimeSettings({ environmentId, status }: PeerSlotProps) {
  const { owner } = usePeerPluginControl(environmentId);
  const isLocalDesktop = useIsLocalDesktop(environmentId);
  const setRuntime = useAtomCommand(serverEnvironment.peerHerdrSetRuntime, {
    reportFailure: false,
  });
  const restartRuntime = useAtomCommand(serverEnvironment.peerHerdrRestartRuntime, {
    reportFailure: false,
  });
  const openTerminal = useAtomCommand(serverEnvironment.peerHerdrOpenTerminal, {
    reportFailure: false,
  });
  const setIntegration = useAtomCommand(serverEnvironment.peerHerdrSetIntegration, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  // No terminal could be opened: the command to copy stands in for the button.
  const [openFailed, setOpenFailed] = useState(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: "the herdr command",
    onError: (error) =>
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not copy the command",
          description: error.message,
        }),
      ),
  });
  const herdr = status.herdr;
  const actions = herdrRuntimeActions(status, isLocalDesktop);

  /** Asks first when the change needs it, then runs it; a failure shows as a toast. */
  async function change(
    title: string,
    confirmation: HerdrConfirmation | null,
    send: () => Promise<Parameters<typeof reportFailure>[1]>,
  ): Promise<boolean> {
    if (confirmation !== null && !(await confirmed(confirmation.message, confirmation.destructive)))
      return false;
    setBusy(true);
    try {
      return reportFailure(title, await send());
    } finally {
      setBusy(false);
    }
  }

  const runtime = herdr?.runtime;
  const attachCommand = runtime?.attachCommand;
  const attach = openFailed && attachCommand !== undefined ? "copy" : actions.attach;
  const lines = [
    runtime === undefined ? null : otherRunningLine(runtime),
    runtime === undefined ? null : pendingUpgradeLine(runtime),
    runtime === undefined ? null : runtimeDetailLine(runtime),
  ].filter((line) => line !== null);
  const disabled = busy || actions.waiting || !owner;

  return (
    <>
      <SettingsRow
        title="herdr"
        description={herdrRuntimeLabel(status)}
        control={
          herdr === undefined ? undefined : (
            <div className="flex flex-wrap justify-end gap-2">
              {actions.power === null ? null : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => {
                    const on = actions.power === "turn-on";
                    void change(
                      on ? "Could not turn on herdr" : "Could not turn off herdr",
                      on ? null : turnOffConfirmation(herdr.runtime),
                      () => setRuntime({ environmentId, input: { on } }),
                    );
                  }}
                >
                  {actions.power === "turn-on" ? "Turn on" : "Turn off"}
                </Button>
              )}
              {actions.restart ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() =>
                    void change("Could not restart herdr", restartConfirmation(herdr.runtime), () =>
                      restartRuntime({ environmentId, input: {} }),
                    )
                  }
                >
                  Restart
                </Button>
              ) : null}
              {attach === "open" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !owner}
                  onClick={() =>
                    void change("Could not open herdr", null, () =>
                      openTerminal({ environmentId, input: {} }),
                    ).then((opened) => setOpenFailed(!opened))
                  }
                >
                  Open herdr
                </Button>
              ) : null}
            </div>
          )
        }
      >
        {lines.length === 0 && !(attach === "copy" && attachCommand !== undefined) ? null : (
          <div className="flex flex-col gap-2 pb-3 text-xs text-muted-foreground">
            {lines.map((line) => (
              <p key={line} role="status">
                {line}
              </p>
            ))}
            {attach === "copy" && attachCommand !== undefined ? (
              <div className="flex flex-wrap items-center gap-2">
                <span>To attach a terminal on that computer, run</span>
                <code className="break-all text-foreground">{attachCommand}</code>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isCopied}
                  onClick={() => copyToClipboard(attachCommand, undefined)}
                >
                  {isCopied ? "Copied" : "Copy"}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </SettingsRow>
      {herdr?.integrations.map((integration) => (
        <IntegrationRow
          key={integration.agent}
          integration={integration}
          disabled={busy || !owner}
          onChange={(kind) =>
            void change(
              kind === "install"
                ? `Could not install the ${integration.agent} integration`
                : `Could not remove the ${integration.agent} integration`,
              integrationConfirmation(integration, kind),
              () =>
                setIntegration({
                  environmentId,
                  input: { agent: integration.agent, installed: kind === "install" },
                }),
            )
          }
        />
      ))}
    </>
  );
}

function IntegrationRow({
  integration,
  disabled,
  onChange,
}: {
  readonly integration: PeerHerdrIntegration;
  readonly disabled: boolean;
  readonly onChange: (kind: "install" | "remove") => void;
}) {
  const row = herdrIntegrationRow(integration);
  return (
    <SettingsRow
      title={`herdr integration for ${row.name}`}
      description={row.description}
      control={
        row.actions.length === 0 ? undefined : (
          <div className="flex flex-wrap justify-end gap-2">
            {row.actions.map((action) => (
              <Button
                key={action.kind}
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => onChange(action.kind)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )
      }
    />
  );
}
