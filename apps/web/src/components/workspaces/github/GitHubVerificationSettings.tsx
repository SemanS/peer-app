import type { PeerGitHubStatus } from "@t3tools/contracts";
import { useState } from "react";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { failureMessage } from "../WorkspaceAccess";
import type { WorkspaceSettingsSlotProps } from "../slots.types";
export function GitHubVerificationSettings({
  environmentId,
  workspace,
}: WorkspaceSettingsSlotProps) {
  const read = useAtomCommand(serverEnvironment.peerGitHubStatus, { reportFailure: false });
  const [status, setStatus] = useState<PeerGitHubStatus | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
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
    <div className="space-y-2 py-3">
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void load()}>
        GitHub verification · {workspace.name}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!status ? null : status.unsupported ? (
        <p className="text-sm text-muted-foreground">
          This hub does not verify pull requests with GitHub.
        </p>
      ) : (
        <div className="space-y-2 text-sm">
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
    </div>
  );
}
