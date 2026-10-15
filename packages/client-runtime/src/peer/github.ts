import {
  WS_METHODS,
  type PeerGitHubStatus,
  type PeerHubStatus,
  type PeerWorkThread,
} from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "../state/runtime.ts";

/** Signing in to GitHub through GitHub CLI on the environment, and cancelling that. */
export function createPeerGitHubAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  return {
    peerGitHubStatus: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:github:status",
      tag: WS_METHODS.peerGitHubStatus,
    }),
    peerHubConnectGitHub: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-hub:connect-github",
      tag: WS_METHODS.peerHubConnectGitHub,
    }),
    peerHubCancelGitHubSignIn: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-hub:cancel-github-sign-in",
      tag: WS_METHODS.peerHubCancelGitHubSignIn,
    }),
  };
}

/**
 * What the verification section of a workspace's settings reads the Hub again for. The Hub answers
 * what the webhook, the last ping and the repositories are, and nothing pushes that, so the section
 * reads when this changes while it is open: the workspace's applied configuration (applying or
 * removing the `github` block moves it), what the status says of verification (turned on or off,
 * a delivery verified) and the newest verification the workspace's pull requests carry.
 */
export function verificationReadKey(
  status: Pick<PeerHubStatus, "github">,
  workspace: {
    readonly slug: string;
    readonly revision?: string | undefined;
    readonly projects: ReadonlyArray<{
      readonly work: { readonly threads: ReadonlyArray<Pick<PeerWorkThread, "pullRequests">> };
    }>;
  },
): string {
  const entry = status.github.verification?.find((v) => v.workspace === workspace.slug);
  let delivered = "";
  for (const { work } of workspace.projects)
    for (const thread of work.threads)
      for (const pr of thread.pullRequests ?? [])
        if (pr.github && pr.github.verifiedAt > delivered) delivered = pr.github.verifiedAt;
  return [
    workspace.revision ?? "",
    entry?.configured ?? "",
    entry?.unsupported ?? "",
    entry?.lastVerifiedAt ?? "",
    delivered,
  ].join("|");
}

/**
 * Whether the Hub is waiting to hear from GitHub: verification is on and no delivery has been
 * verified yet. GitHub's first ping, which the section shows, publishes nothing to follow, so the
 * open section asks the Hub every `VERIFICATION_POLL_MS` until a delivery is verified.
 */
export const verificationWaiting = (
  status: Pick<PeerGitHubStatus, "configured" | "unsupported" | "lastVerifiedAt">,
) => status.configured && status.unsupported !== true && status.lastVerifiedAt === null;

export const VERIFICATION_POLL_MS = 10_000;

export { deliveryBadge, pullRequestRows, taskDelivery } from "@t3tools/contracts";
