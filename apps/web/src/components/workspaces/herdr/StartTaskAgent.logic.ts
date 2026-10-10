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

const HARNESS_NAME = { claude: "Claude Code", codex: "Codex" } as const;

/**
 * What an agent started here runs on: herdr agents run on the person's own login, which the
 * project's capacity policy must allow. Shared capacity for them is not offered (yet).
 */
export function capacityLine(
  project: { readonly project: { readonly capacity: { readonly personal: string } } },
  harness: keyof typeof HARNESS_NAME,
): { readonly allowed: boolean; readonly line: string } {
  return project.project.capacity.personal === "any"
    ? { allowed: true, line: `Your own ${HARNESS_NAME[harness]} login · runs only your work` }
    : {
        allowed: false,
        line: "This project's capacity policy does not let herdr agents run on your own login.",
      };
}
