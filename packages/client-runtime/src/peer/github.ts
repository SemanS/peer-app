import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "../state/runtime.ts";

/** Signing in to GitHub through GitHub CLI on the environment, and cancelling that. */
export function createPeerGitHubAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  return {
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
