import {
  VERIFICATION_POLL_MS,
  verificationReadKey,
  verificationWaiting,
} from "@t3tools/client-runtime/peer/github";
import type { PeerGitHubStatus } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { FoldedSettingsRow, NestedRowTitle, SettingsRowError } from "../PeerSettingsRows";
import { failureMessage } from "../WorkspaceAccess";
import type { WorkspaceSettingsSlotProps } from "../slots.types";

/**
 * One workspace's verification as the Hub answers it. It reads when the row opens and again while
 * it is open whenever the status says the workspace's configuration or verification moved, and now
 * and then while the Hub waits to hear from GitHub, so applying the `github` block shows without a
 * reload.
 */
export function GitHubVerificationSettings({
  environmentId,
  status: hub,
  workspace,
}: WorkspaceSettingsSlotProps) {
  const read = useAtomCommand(serverEnvironment.peerGitHubStatus, { reportFailure: false });
  const target = `${environmentId}/${workspace.slug}`;
  // An answer belongs to the workspace it was read for; one read for another is not shown.
  const [answer, setAnswer] = useState<{
      readonly target: string;
      readonly status: PeerGitHubStatus;
    } | null>(null),
    [error, setError] = useState<string | null>(null),
    [open, setOpen] = useState(false);
  const status = answer?.target === target ? answer.status : null;
  // Only the latest read counts: a slower, older one must not show over it.
  const latest = useRef(0);
  const reload = useEffectEvent(() => {
    const mine = ++latest.current;
    void read({ environmentId, input: { workspace: workspace.slug } }).then((result) => {
      if (mine !== latest.current) return;
      if (result._tag === "Success") {
        setAnswer({ target, status: result.value });
        setError(null);
      } else setError(failureMessage(result));
    });
  });
  const readKey = open ? `${target}|${verificationReadKey(hub, workspace)}` : null;
  useEffect(() => {
    if (readKey !== null) reload();
  }, [readKey]);
  const waiting = open && status !== null && verificationWaiting(status);
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(() => {
      if (!document.hidden) reload();
    }, VERIFICATION_POLL_MS);
    return () => clearInterval(timer);
  }, [waiting]);
  return (
    <FoldedSettingsRow
      title={<NestedRowTitle under="workspace">GitHub verification</NestedRowTitle>}
      label={`GitHub verification for ${workspace.name}`}
      description="Whether the hub hears GitHub’s pull request events, so merged work closes its tasks."
      open={open}
      onOpenChange={setOpen}
    >
      {error ? <SettingsRowError>{error}</SettingsRowError> : null}
      {open && status === null && error === null ? (
        <p role="status" className="text-xs text-muted-foreground">
          Reading…
        </p>
      ) : null}
      {!status ? null : status.unsupported ? (
        <p className="text-sm text-muted-foreground">
          This hub does not verify pull requests with GitHub.
        </p>
      ) : (
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>
            {!status.configured
              ? "Verification is off. Add github: {} to workspace.yaml, then validate and apply it."
              : status.lastVerifiedAt
                ? `Receiving deliveries. Last verified ${status.lastVerifiedAt}.`
                : status.lastPingAt
                  ? `Receiving GitHub's ping since ${status.lastPingAt}.`
                  : "Waiting for GitHub's ping."}
          </p>
          <p>Payload URL: {status.webhookUrl ?? "Update the Hub to supply its webhook path."}</p>
          <p>
            Use application/json and the Pull requests event in GitHub's repository or organization
            webhook settings.
          </p>
          {workspace.role !== "member" ? (
            <>
              <p>
                Generate a webhook secret and store it with:{" "}
                <code>peerhub workspace secret {workspace.slug} github-webhook</code>. Set the same
                value in GitHub.
              </p>
              <p>Hub secret: {status.secret ?? "unknown"}.</p>
            </>
          ) : null}
          <p>
            GitHub must reach this address. A Hub on localhost or a private network receives no
            deliveries. Redeliver missed events within three days from GitHub's webhook settings.
          </p>
          {status.repositories.map((r) => (
            <p key={`${r.project}/${r.repository}`}>
              {r.project}/{r.repository}:{" "}
              {r.github ?? "outside github.com; a person closes its tasks"}
            </p>
          ))}
        </div>
      )}
    </FoldedSettingsRow>
  );
}
