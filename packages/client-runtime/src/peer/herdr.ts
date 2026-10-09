import { WS_METHODS, type PeerLocalAgent } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "../state/runtime.ts";

/** Capability is established by the running session, never inferred from installed settings. */
export function peerCoordinationLabel(
  level: PeerLocalAgent["coordinationLevel"],
  advisoryTools = false,
): string {
  if (level === "A") return "A · action enforced";
  if (level === "B") return "B · hooks active";
  if (advisoryTools) return "B-mcp · advisory tools";
  return "C · observed after work";
}

export function peerCoordinationDetail(
  level: PeerLocalAgent["coordinationLevel"],
  advisoryTools = false,
): string {
  if (level === "A")
    return "A live Claude Mod checks tracked edits with the hub before the action.";
  if (level === "B")
    return "The live session runs Peer hooks. Blocking guarantees depend on the hook deadline.";
  if (advisoryTools)
    return "The agent can check paths with the Hub through its Peer tools. Peer cannot stop its edits.";
  return "Peer observes uncommitted paths after completed work. It cannot prevent overlapping edits or attribute every change to this agent.";
}

export function peerAgentStartBlocker(status: {
  readonly signedIn: boolean;
  readonly agents: { readonly herdr: "running" | "not-running" };
}): string | null {
  if (!status.signedIn) return "Sign in to a Peer workspace on this environment first.";
  if (status.agents.herdr !== "running")
    return "Install and start herdr on the selected environment, then try again.";
  return null;
}

/** The same launch requirements for a task or request on every client. */
export function peerLaunchBlocker(
  status: Parameters<typeof peerAgentStartBlocker>[0],
  project: {
    readonly project: { readonly capacity: { readonly personal: string } };
    readonly repositories: ReadonlyArray<{ readonly state: string }>;
  },
): string | null {
  return (
    peerAgentStartBlocker(status) ??
    (project.project.capacity.personal !== "any"
      ? "Use a Peer thread with an approved provider for this project's capacity policy."
      : !project.repositories.some((repository) => repository.state === "ready")
        ? "Clone and open the project on this environment first."
        : null)
  );
}

/** Showing a herdr agent in herdr, following its work, and prompting it. */
export function createPeerHerdrAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  return {
    peerHubFocusAgent: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-hub:focus-agent",
      tag: WS_METHODS.peerHubFocusAgent,
    }),
    /** A herdr agent's work as it happens: its view on subscribe, then each change. */
    peerHubWatchAgent: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:peer-hub:watch-agent",
      tag: WS_METHODS.peerHubWatchAgent,
    }),
    peerHubPromptAgent: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-hub:prompt-agent",
      tag: WS_METHODS.peerHubPromptAgent,
    }),
  };
}
