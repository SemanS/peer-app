export { personName, overlapTopic } from "@t3tools/client-runtime/peer/needs-you";
import type {
  EnvironmentId,
  PeerCoordinationPolicy,
  PeerHubStatus,
  PeerHubSetCoordinationInput,
} from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { computerKinds, experimentStartStep } from "./vcsWords";
import { failureMessage } from "./WorkspaceAccess";
import { withFinally } from "~/lib/withFinally";

const POLICIES: ReadonlyArray<{
  readonly value: PeerCoordinationPolicy;
  readonly label: string;
  readonly hint: string;
}> = [
  {
    value: "notify",
    label: "Notify",
    hint: "An agent about to change a file another agent changed hears who and what they work on, and goes on.",
  },
  {
    value: "coordinate",
    label: "Coordinate",
    hint: "An overlapping edit waits until your agent acknowledges the current overlap or writes a coordination note. You can follow the agreement here.",
  },
  {
    value: "ask",
    label: "Ask me",
    hint: "Your agent asks you before it changes a file another agent changed.",
  },
];

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

/**
 * Settings → Peer → Coordination & plugins: agents coordinating with the team's (experimental).
 * The page that shows the default policy itself leaves it out of these controls (`hidePolicy`).
 */
export function CoordinationControls({
  environmentId,
  status,
  hidePolicy = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly hidePolicy?: boolean;
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
          {hidePolicy ? null : (
            <>
              <p className="text-xs text-muted-foreground">
                Default overlap policy on this environment. A project's policy in Peer Hub takes
                precedence.
              </p>
              <ToggleGroup
                className="w-full"
                aria-label="Default overlap policy on this environment"
                variant="segmented"
                value={[coordination.policy]}
                onValueChange={(next) => {
                  const policy = POLICIES.find((p) => p.value === next[0])?.value;
                  if (policy !== undefined) void run({ policy });
                }}
              >
                {POLICIES.map((policy) => (
                  <Toggle key={policy.value} className="flex-1" value={policy.value}>
                    {policy.label}
                  </Toggle>
                ))}
              </ToggleGroup>
              <p className="text-xs text-muted-foreground">
                {POLICIES.find((p) => p.value === coordination.policy)?.hint}
              </p>
            </>
          )}
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
                      agent activity to Peer and coordinate overlapping edits.
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
            . Enable detailed logging in Settings → Peer → Coordination & plugins.
          </p>
          <ExperimentSteps status={status} />
        </>
      ) : null}
    </div>
  );
}

/** A short experiment to run on two computers, so the log shows how agents settle an overlap. */
function ExperimentSteps({ status }: { readonly status: PeerHubStatus }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button className="self-start" size="xs" variant="ghost" onClick={() => setOpen(true)}>
        Experiment: two agents, one file
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border p-2 text-xs text-muted-foreground">
      <p className="font-medium text-foreground">Experiment: two agents, one file</p>
      <ol className="list-decimal space-y-1 pl-4">
        <li>
          On both computers: the same workspace project cloned, coordination on, Coordinate, and
          Peer's hooks added to the agent you use there (Claude Code or Codex).
        </li>
        <li>{experimentStartStep(computerKinds(status))}</li>
        <li>
          Computer A: “In apps/server/src/webhooks.rs every delivery should also send user-agent:
          app-webhooks/&lt;version&gt; and webhook-attempt: &lt;n&gt; (1-based); pass the attempt
          from round() into post(). Keep it small, do not run cargo, do not push.”
        </li>
        <li>
          A minute later, computer B: “In apps/server/src/webhooks.rs let post() sign the delivery
          itself (give it the secret instead of a ready signature) and rename sign() to signature(),
          keeping the specification test. Keep it small, do not run cargo, do not push.”
        </li>
        <li>
          Turn on the debug log first in Settings → Peer → Coordination & plugins, watch the
          Overlaps section of Work, then send both coordination.debug.jsonl files. The regular log
          contains no detail.
        </li>
      </ol>
      <Button className="self-start" size="xs" variant="ghost" onClick={() => setOpen(false)}>
        Hide
      </Button>
    </div>
  );
}
