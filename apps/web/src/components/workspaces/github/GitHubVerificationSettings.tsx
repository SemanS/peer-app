import type { PeerGitHubStatus } from "@t3tools/contracts";
import { useState } from "react";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { FoldedSettingsRow, NestedRowTitle, SettingsRowError } from "../PeerSettingsRows";
import { failureMessage } from "../WorkspaceAccess";
import type { WorkspaceSettingsSlotProps } from "../slots.types";
export function GitHubVerificationSettings({
  environmentId,
  workspace,
}: WorkspaceSettingsSlotProps) {
  const read = useAtomCommand(serverEnvironment.peerGitHubStatus, { reportFailure: false });
  const [status, setStatus] = useState<PeerGitHubStatus | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [open, setOpen] = useState(false);
  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await read({ environmentId, input: { workspace: workspace.slug } });
      if (result._tag === "Success") setStatus(result.value);
      else setError(failureMessage(result));
    } finally {
      setBusy(false);
    }
  };
  return (
    <FoldedSettingsRow
      title={<NestedRowTitle under="workspace">GitHub verification</NestedRowTitle>}
      label={`GitHub verification for ${workspace.name}`}
      description="Whether the hub hears GitHub’s pull request events, so merged work closes its tasks."
      open={open}
      busy={busy}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      {error ? <SettingsRowError>{error}</SettingsRowError> : null}
      {busy && !status ? (
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
