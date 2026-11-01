import type { EnvironmentId, PeerHubStatus, PeerHubSetCoordinationInput } from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { failureMessage } from "./WorkspaceAccess";
import { withFinally } from "~/lib/withFinally";

function report(title: string, result: AtomCommandResult<unknown, unknown>) {
  const message = failureMessage(result);
  if (message !== null) {
    toastManager.add(stackedThreadToast({ type: "error", title, description: message }));
  }
}

/** The agents Peer adds its hooks to, so they take part wherever they run (herdr, Peer, a terminal). */
const AGENTS = [
  { hooks: "claudeHooks", name: "Claude Code" },
  { hooks: "codexHooks", name: "Codex" },
] as const;

/** Settings → Peer → Plugins: agents coordinating with the team's, through their hooks. */
export function CoordinationControls({
  environmentId,
  status,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
}) {
  const set = useAtomCommand(serverEnvironment.peerHubSetCoordination, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const coordination = status.coordination;
  const run = async (input: PeerHubSetCoordinationInput) => {
    setBusy(true);
    await withFinally(
      async () => {
        report("Could not change agent coordination", await set({ environmentId, input }));
      },
      () => {
        setBusy(false);
      },
    );
  };
  return (
    <div className="flex max-w-xl flex-col gap-3 pt-2 pb-3">
      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={coordination.enabled}
          disabled={busy}
          aria-label="Coordinate this computer's agents with the team's"
          onCheckedChange={(enabled) => void run({ enabled })}
        />
        Coordinate this computer's agents with the team's
      </label>
      {coordination.enabled ? (
        <>
          {AGENTS.map((agent) => {
            const added = coordination[agent.hooks] === true;
            const present =
              agent.hooks === "claudeHooks"
                ? coordination.claudeHooksPresent === true
                : coordination.codexHookHomes?.some((home) => home.present);
            // A Peer that cannot add hooks to this agent does not say whether it runs them.
            if (coordination[agent.hooks] === undefined) return null;
            return (
              <div
                key={agent.hooks}
                className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
              >
                <span className="min-w-0 flex-1">
                  {added
                    ? agent.hooks === "codexHooks"
                      ? "The Peer plugin is installed in all configured Codex homes."
                      : `Peer's hooks are installed for ${agent.name}. New sessions take part once the agent loads them.`
                    : agent.hooks === "codexHooks"
                      ? "Add the Peer plugin to Codex so its agents take part, wherever they run."
                      : `Add Peer's hooks to ${agent.name} so its agents take part, wherever they run.`}
                  {added && agent.hooks === "codexHooks"
                    ? coordination.codexHooksTrusted === true
                      ? " Codex trusts them in every configured home."
                      : coordination.codexHookHomes === undefined
                        ? " Review and trust each Peer command in Codex's /hooks screen."
                        : " Review the Peer commands for each home below before new sessions can coordinate."
                    : null}
                </span>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run({ [agent.hooks]: !added })}
                >
                  {added ? `Remove from ${agent.name}` : `Add to ${agent.name}`}
                </Button>
                {!added && present ? (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run({ [agent.hooks]: false })}
                  >
                    Remove from {agent.name}
                  </Button>
                ) : null}
              </div>
            );
          })}
          {coordination.codexHookHomes?.map((home) => (
            <details key={home.home} className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">
                Codex: {home.home},{" "}
                {!coordination.enabled
                  ? "coordination paused"
                  : home.trusted
                    ? "ready for new sessions"
                    : home.installed
                      ? "needs review"
                      : "plugin missing or changed"}
              </summary>
              <div className="flex flex-col gap-2 pt-2">
                <p>
                  Plugin hooks: <code className="select-all">{home.hooksPath}</code>
                </p>
                {home.error === undefined ? null : <p>{home.error}</p>}
                {!home.installed ? (
                  <p>
                    Choose Add to Codex to install the Peer plugin in all configured homes on this
                    environment.
                  </p>
                ) : (
                  <>
                    <p>
                      These commands run on this environment outside Codex's sandbox. They report
                      agent activity to Peer and coordinate overlapping edits. Codex runs them only
                      while its approval names both the commands and the plugin's files, so after a
                      Peer update rewrites the plugin, trust them here again.
                      {!coordination.enabled ? " Trusting them also enables coordination." : ""}
                    </p>
                    <ul className="flex flex-col gap-1">
                      {home.hooks.map((hook) => (
                        <li key={hook.key}>
                          {hook.event}
                          {hook.matcher === undefined ? "" : ` (${hook.matcher})`}:{" "}
                          <code className="select-all">{hook.command}</code>
                          {hook.enabled ? "" : " (disabled in Codex)"}
                        </li>
                      ))}
                    </ul>
                    {home.hooks.some((hook) => !hook.enabled) ? (
                      <p>
                        Some Peer hooks are disabled in Codex. Enable them there before new sessions
                        can coordinate.
                      </p>
                    ) : null}
                    {!home.trusted ? (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={busy || home.hooks.some((hook) => !hook.enabled)}
                        onClick={() =>
                          void run({
                            codexHookApproval: { home: home.home, reviewId: home.reviewId },
                          })
                        }
                      >
                        Trust these Peer hooks
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            </details>
          ))}
          <p className="text-xs text-muted-foreground">
            Coordination counts, sizes and timings are logged without text to{" "}
            <code className="rounded bg-muted px-1 py-px text-2xs select-all">
              {coordination.logPath}
            </code>
            . Enable detailed logging in Settings → Peer → Plugins.
          </p>
        </>
      ) : null}
    </div>
  );
}
