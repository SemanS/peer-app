import { herdrNeedsInstall, peerLaunchBlocker } from "@t3tools/client-runtime/peer/herdr";
import { requestStartInput } from "@t3tools/client-runtime/peer/requests";
import type { PeerAgentRequest } from "@t3tools/contracts";
export const startInput = (request: PeerAgentRequest | undefined, text: string) =>
  request === undefined ? { prompt: text.trim() } : requestStartInput(request, text);

/**
 * Why the agent cannot start (the words come from client-runtime), and whether to offer the install
 * link: only where Peer has no herdr to run, not while herdr is off, starting or has failed.
 */
export function launchGuidance(
  status: Parameters<typeof peerLaunchBlocker>[0],
  project: Parameters<typeof peerLaunchBlocker>[1],
) {
  return { blocked: peerLaunchBlocker(status, project), installLink: herdrNeedsInstall(status) };
}
