import { herdrAttachOffer, type PeerHerdrView } from "@t3tools/client-runtime/peer/herdr";
import type {
  PeerHerdrIntegration,
  PeerHerdrIntegrationAgent,
  PeerHerdrRuntime,
} from "@t3tools/contracts";

/** What the herdr runtime row offers in its state. */
export interface HerdrRuntimeActions {
  /** Peer's herdr is on: Turn off. Off: Turn on. Null where Peer has no herdr to run. */
  readonly power: "turn-off" | "turn-on" | null;
  readonly restart: boolean;
  /** Open a terminal here, show the command to copy, or nothing to attach to. */
  readonly attach: "open" | "copy" | "none";
  /** herdr is starting or stopping: its actions wait. */
  readonly waiting: boolean;
}

const NO_ACTIONS: HerdrRuntimeActions = {
  power: null,
  restart: false,
  attach: "none",
  waiting: false,
};

/**
 * Which actions show per state. The person's own herdr is never turned off or restarted from
 * here. Restart also recovers a failed herdr, and applies a waiting upgrade.
 */
export function herdrRuntimeActions(
  status: PeerHerdrView,
  isLocalDesktop: boolean,
): HerdrRuntimeActions {
  const herdr = status.herdr;
  if (herdr === undefined) return NO_ACTIONS;
  const { runtime } = herdr;
  // Without a bundled binary Peer has no herdr of its own to turn on, off or restart.
  if (runtime.bundledVersion === undefined) {
    return { ...NO_ACTIONS, attach: herdrAttachOffer(status, isLocalDesktop) };
  }
  const waiting = runtime.state === "starting" || runtime.state === "stopping";
  return {
    power: herdr.bundled ? "turn-off" : "turn-on",
    restart:
      herdr.bundled &&
      !waiting &&
      (runtime.state === "failed" || (runtime.source === "peer" && runtime.state === "running")),
    attach: herdrAttachOffer(status, isLocalDesktop),
    waiting,
  };
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Which of the agents herdr can bring back after a restart, and that the others stop. */
function resumeSentence(runtime: Pick<PeerHerdrRuntime, "agents" | "resumable">): string {
  const { agents, resumable } = runtime;
  if (agents === 1)
    return resumable >= 1 ? "It stops and can resume when herdr is back." : "It stops.";
  if (resumable >= agents) return "All stop and can resume when herdr is back.";
  if (resumable === 0) return "They all stop.";
  return `${resumable} of ${agents} can resume; the others stop.`;
}

export interface HerdrConfirmation {
  readonly message: string;
  readonly destructive: boolean;
}

/** What turning Peer's herdr off asks first: nothing runs, nothing to ask. */
export function turnOffConfirmation(
  runtime: Pick<PeerHerdrRuntime, "agents" | "resumable">,
): HerdrConfirmation | null {
  if (runtime.agents === 0) return null;
  return {
    message: `Turn off Peer's herdr? It runs ${plural(runtime.agents, "agent")}. ${resumeSentence(runtime)}`,
    destructive: true,
  };
}

export function restartConfirmation(
  runtime: Pick<PeerHerdrRuntime, "agents" | "resumable" | "bundledVersion" | "pendingUpgrade">,
): HerdrConfirmation | null {
  if (runtime.agents === 0) return null;
  const upgrade =
    runtime.pendingUpgrade === true && runtime.bundledVersion !== undefined
      ? ` It restarts on herdr ${runtime.bundledVersion}.`
      : "";
  return {
    message: `Restart Peer's herdr? It runs ${plural(runtime.agents, "agent")}.${upgrade} ${resumeSentence(runtime)}`,
    destructive: true,
  };
}

export const HERDR_AGENT_NAMES: Record<PeerHerdrIntegrationAgent, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

/** One integration row: its state in words, and the changes the owner may make. */
export interface HerdrIntegrationRow {
  readonly name: string;
  readonly description: string;
  /** `install` also updates an outdated one. */
  readonly actions: ReadonlyArray<{ readonly kind: "install" | "remove"; readonly label: string }>;
}

export function herdrIntegrationRow(integration: PeerHerdrIntegration): HerdrIntegrationRow {
  const name = HERDR_AGENT_NAMES[integration.agent];
  switch (integration.state) {
    case "installed":
      return {
        name,
        description: "Installed. herdr can resume this agent after it restarts.",
        actions: [{ kind: "remove", label: "Remove" }],
      };
    case "outdated":
      return {
        name,
        description: "Installed, but outdated.",
        actions: [
          { kind: "install", label: "Update" },
          { kind: "remove", label: "Remove" },
        ],
      };
    case "missing":
      return {
        name,
        description: "Not installed. Without it herdr cannot resume this agent after it restarts.",
        actions: [{ kind: "install", label: "Install" }],
      };
    case "unavailable":
      return {
        name,
        description: integration.reason ?? "Unavailable on this computer.",
        actions: [],
      };
  }
}

/** The confirmation of an install, update or removal, which names the files it changes. */
export function integrationConfirmation(
  integration: PeerHerdrIntegration,
  kind: "install" | "remove",
): HerdrConfirmation {
  const name = HERDR_AGENT_NAMES[integration.agent];
  const files =
    integration.files.length === 0 ? "" : ` This changes ${integration.files.join(", ")}.`;
  return kind === "install"
    ? {
        message: `${integration.state === "outdated" ? "Update" : "Install"} the herdr integration for ${name}?${files}`,
        destructive: false,
      }
    : {
        message: `Remove the herdr integration for ${name}?${files} herdr can no longer resume its agents after a restart.`,
        destructive: true,
      };
}

/** Peer keeps its herdr while it runs agents the person's own herdr could not take. */
export function otherRunningLine(runtime: PeerHerdrRuntime): string | null {
  if (!runtime.otherRunning || runtime.source !== "peer" || runtime.agents === 0) return null;
  return `Your herdr is running too; Peer keeps using its own until its ${plural(runtime.agents, "agent")} finish`;
}

export function pendingUpgradeLine(runtime: PeerHerdrRuntime): string | null {
  if (runtime.pendingUpgrade !== true) return null;
  return `herdr ${runtime.bundledVersion ?? "(newer)"} is ready; it starts when your agents finish or when you restart herdr`;
}

/** Where to look when herdr failed, or why none is available. */
export function runtimeDetailLine(runtime: PeerHerdrRuntime): string | null {
  if (runtime.state === "failed")
    return runtime.log === undefined ? null : `herdr's log is at ${runtime.log}`;
  return runtime.state === "unavailable" ? (runtime.reason ?? null) : null;
}
