import { WS_METHODS, type PeerHerdrStatus, type PeerLocalAgent } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

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

/**
 * What a client reads of the status to tell which herdr serves: the runtime the server reports
 * (absent from a server that predates it) and the legacy flag every server sends.
 */
export interface PeerHerdrView {
  readonly agents: { readonly herdr: "running" | "not-running" };
  readonly herdr?: PeerHerdrStatus | undefined;
}

const INSTALL_BLOCKER = "Install and start herdr on the selected environment, then try again.";

/** Why an agent cannot start in herdr, or null. The words match the server's (design D7). */
function herdrStartBlocker(status: PeerHerdrView): string | null {
  const runtime = status.herdr?.runtime;
  // A server from before the runtime knows only whether herdr answers.
  if (runtime === undefined) return status.agents.herdr === "running" ? null : INSTALL_BLOCKER;
  switch (runtime.state) {
    case "running":
      return null;
    case "starting":
      return "herdr is starting on this computer";
    case "stopping":
      return "herdr is restarting on this computer";
    case "off":
      return "Peer's herdr is off. Turn it on in Settings → Peer → Coordination & plugins, or start your own herdr.";
    case "failed":
      return `${runtime.reason ?? "Peer's herdr failed."} Restart it in Settings → Peer → Coordination & plugins.`;
    case "unavailable":
      return INSTALL_BLOCKER;
  }
}

/** Whether the person is told to install herdr: where Peer has none to run and none answers. */
export function herdrNeedsInstall(status: PeerHerdrView): boolean {
  const runtime = status.herdr?.runtime;
  return runtime === undefined
    ? status.agents.herdr !== "running"
    : runtime.state === "unavailable";
}

export function peerAgentStartBlocker(
  status: PeerHerdrView & { readonly signedIn: boolean },
): string | null {
  if (!status.signedIn) return "Sign in to a Peer workspace on this environment first.";
  return herdrStartBlocker(status);
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

/** Which herdr is in use, in a line: "Peer's herdr 0.9.3 · running · 2 agents", "Your herdr 0.9.4". */
export function herdrRuntimeLabel(status: PeerHerdrView): string {
  const runtime = status.herdr?.runtime;
  if (runtime === undefined)
    return status.agents.herdr === "running"
      ? "herdr is running"
      : "No herdr · install herdr on this computer";
  const version = runtime.version === undefined ? "" : ` ${runtime.version}`;
  switch (runtime.state) {
    case "running": {
      if (runtime.source === "own") return `Your herdr${version}`;
      const agents =
        runtime.agents === 0
          ? "no agents"
          : `${runtime.agents} ${runtime.agents === 1 ? "agent" : "agents"}`;
      return `Peer's herdr${version} · running · ${agents}`;
    }
    case "starting":
      return "Starting…";
    case "stopping":
      return "Restarting…";
    case "off":
      return "Off";
    case "failed":
      return `Failed: ${runtime.reason ?? "herdr did not start"}`;
    case "unavailable":
      return "No herdr · install herdr on this computer";
  }
}

/**
 * How a client offers to attach a terminal to Peer's herdr: "open" a window on this computer (the
 * desktop app connected to its own backend), "copy" the command to run there, or "none" where Peer
 * runs no herdr of its own to attach to.
 */
export function herdrAttachOffer(
  status: PeerHerdrView,
  isLocalDesktop: boolean,
): "open" | "copy" | "none" {
  const runtime = status.herdr?.runtime;
  if (runtime?.source !== "peer" || runtime.state !== "running") return "none";
  return isLocalDesktop ? "open" : runtime.attachCommand === undefined ? "none" : "copy";
}

/**
 * Showing a herdr agent in herdr (`peerHubFocusAgent` takes `openWindow` to open a terminal first),
 * following its work, prompting it, and the owner's controls over Peer's own herdr.
 */
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
    peerHubAnswerAgentTrust: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-hub:answer-agent-trust",
      tag: WS_METHODS.peerHubAnswerAgentTrust,
    }),
    /** Peer's own herdr: turn it off or on, restart it, open a terminal on it, install its hooks. */
    peerHerdrSetRuntime: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-herdr:set-runtime",
      tag: WS_METHODS.peerHerdrSetRuntime,
    }),
    peerHerdrRestartRuntime: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-herdr:restart-runtime",
      tag: WS_METHODS.peerHerdrRestartRuntime,
    }),
    peerHerdrOpenTerminal: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-herdr:open-terminal",
      tag: WS_METHODS.peerHerdrOpenTerminal,
    }),
    peerHerdrSetIntegration: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-herdr:set-integration",
      tag: WS_METHODS.peerHerdrSetIntegration,
    }),
  };
}
