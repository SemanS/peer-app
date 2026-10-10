/**
 * What Peer says when herdr is not ready to start an agent: one sentence for each state of the
 * herdr runtime, the same wherever it is read (the launcher, the CLI, MCP, accepting a request).
 * `packages/client-runtime/src/peer/herdr.ts` says the same words in the apps.
 *
 * @module peerHub/plugins/herdr/client/runtimeText
 */
import type { PeerHerdrRuntime } from "@t3tools/contracts";

/** Where no herdr runs and Peer has none to start. */
export const HERDR_INSTALL_TEXT =
  "herdr is not running on this environment. Install it from https://herdr.dev/docs/install/, start herdr here, then try again.";

/** Why an agent cannot start in this herdr runtime, or null when it can. */
export function herdrBlocker(runtime: PeerHerdrRuntime): string | null {
  switch (runtime.state) {
    case "running":
      return null;
    case "starting":
      return "herdr is starting on this computer";
    case "stopping":
      return "herdr is restarting on this computer";
    case "off":
      return "Peer's herdr is off. Turn it on in Settings → Workspaces, or start your own herdr.";
    case "failed":
      return `${runtime.reason ?? "Peer's herdr failed."} Restart it in Settings → Workspaces.`;
    case "unavailable":
      return HERDR_INSTALL_TEXT;
  }
}
