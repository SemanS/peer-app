import { SettingsRow } from "../../settings/settingsLayout";
import type { NotOpenHereSlotProps, PeerSlotProps } from "../slots";
import { GitHubConnect } from "./GitHubConnect";

/** Settings → Workspaces: GitHub for this environment, which clones with that account. */
export function GitHubSettings({ environmentId, status }: PeerSlotProps) {
  return (
    <SettingsRow
      title="GitHub"
      description={
        status.github.account !== null
          ? `Workspace repositories on GitHub clone as ${status.github.account}, through GitHub CLI.`
          : "Connect GitHub so workspace repositories on GitHub clone with your account."
      }
    >
      <div className="pb-3">
        <GitHubConnect environmentId={environmentId} github={status.github} />
      </div>
    </SettingsRow>
  );
}

/** A project that failed to open for want of a GitHub account offers to connect one, then retries. */
export function GitHubNotOpenHere({
  environmentId,
  status,
  checkout,
  failed,
  onRetry,
}: NotOpenHereSlotProps) {
  if (!failed || !checkout.gitHubSignIn) return null;
  return (
    <GitHubConnect environmentId={environmentId} github={status.github} onConnected={onRetry} />
  );
}

/** What sharing a repository from GitHub clones as, or the way to connect an account. */
export function GitHubShareNote({ environmentId, status }: PeerSlotProps) {
  if (status.github.account !== null) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        GitHub repositories open as {status.github.account}.
      </p>
    );
  }
  if (!status.github.cli) return null;
  return (
    <div className="mt-1.5">
      <GitHubConnect environmentId={environmentId} github={status.github} />
    </div>
  );
}
