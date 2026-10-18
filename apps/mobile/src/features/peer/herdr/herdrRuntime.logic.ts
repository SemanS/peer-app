import type { PeerHerdrView } from "@t3tools/client-runtime/peer/herdr";
import { projectVcs, vcsWords, type PeerVcsKind } from "@t3tools/client-runtime/peer/vcsWords";
import type { PeerHerdrIntegration, PeerHerdrRuntime, PeerHerdrStatus } from "@t3tools/contracts";

/** What the herdr runtime section offers for one state, and the words of its confirmations. */

export interface HerdrRuntimeActions {
  /** Turn Peer's herdr off or on; absent where the build has no herdr to run. */
  readonly power: "turn-off" | "turn-on" | null;
  readonly restart: boolean;
}

export interface HerdrConfirmation {
  readonly title: string;
  readonly message: string;
  readonly confirm: string;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Whether a herdr answers: the runtime when the server reports it, the legacy flag otherwise. */
export function herdrIsRunning(status: PeerHerdrView): boolean {
  const runtime = status.herdr?.runtime;
  return runtime === undefined ? status.agents.herdr === "running" : runtime.state === "running";
}

/** The line for an empty agent list: no herdr to run agents is not the same as no agents. */
export function herdrNoAgentsText(status: PeerHerdrView): string {
  return herdrIsRunning(status) ? "No agents are running in herdr." : "herdr is not running.";
}

/** Peer's herdr is the one in use, so turning it off or restarting it stops its agents. */
const peerRunsAgents = (runtime: PeerHerdrRuntime) =>
  runtime.source === "peer" && runtime.state === "running" && runtime.agents > 0;

/** The owner's controls: never over the person's own herdr, never while herdr changes state. */
export function herdrRuntimeActions(herdr: PeerHerdrStatus): HerdrRuntimeActions {
  const { runtime } = herdr;
  if (runtime.bundledVersion === undefined) return { power: null, restart: false };
  const settled = runtime.state !== "starting" && runtime.state !== "stopping";
  return {
    power: !settled ? null : herdr.bundled ? "turn-off" : "turn-on",
    restart:
      herdr.bundled &&
      runtime.source === "peer" &&
      (runtime.state === "running" || runtime.state === "failed"),
  };
}

/** Turning Peer's herdr off asks first only when it runs agents, which stop. */
export function herdrTurnOffConfirmation(
  runtime: PeerHerdrRuntime,
  agentTitles: ReadonlyArray<string>,
): HerdrConfirmation | null {
  if (!peerRunsAgents(runtime)) return null;
  const named = agentTitles.length === 0 ? "" : `: ${agentTitles.join(", ")}`;
  return {
    title: "Turn off Peer's herdr?",
    message: `${plural(runtime.agents, "agent", "agents")} will stop${named}.`,
    confirm: "Turn off",
  };
}

/** Restarting asks first when agents run, saying how many herdr can bring back. */
export function herdrRestartConfirmation(runtime: PeerHerdrRuntime): HerdrConfirmation | null {
  if (!peerRunsAgents(runtime)) return null;
  const resumable = Math.min(runtime.resumable, runtime.agents);
  const stopped = runtime.agents - resumable;
  const message =
    stopped === 0
      ? `herdr resumes all ${plural(runtime.agents, "agent", "agents")} after the restart.`
      : `herdr resumes ${resumable} of ${plural(runtime.agents, "agent", "agents")}. The other ${stopped} will stop. Install the integrations below to make agents resumable.`;
  return { title: "Restart herdr?", message, confirm: "Restart" };
}

export const INTEGRATION_NAMES = { claude: "Claude Code", codex: "Codex" } as const;

export type HerdrIntegrationRow = {
  readonly agent: PeerHerdrIntegration["agent"];
  readonly name: string;
  /** What the row says: the state, or why none can be installed. */
  readonly stateText: string;
  readonly install: "Install" | "Update" | null;
  readonly remove: boolean;
};

export function herdrIntegrationRow(integration: PeerHerdrIntegration): HerdrIntegrationRow {
  const name = INTEGRATION_NAMES[integration.agent];
  switch (integration.state) {
    case "installed":
      return {
        agent: integration.agent,
        name,
        stateText: "Installed",
        install: null,
        remove: true,
      };
    case "outdated":
      return {
        agent: integration.agent,
        name,
        stateText: "Outdated",
        install: "Update",
        remove: true,
      };
    case "missing":
      return {
        agent: integration.agent,
        name,
        stateText: "Not installed",
        install: "Install",
        remove: false,
      };
    case "unavailable":
      return {
        agent: integration.agent,
        name,
        stateText: integration.reason ?? "Unavailable",
        install: null,
        remove: false,
      };
  }
}

/** Installing, updating or removing changes files in the person's agent configuration: name them. */
export function herdrIntegrationConfirmation(
  integration: PeerHerdrIntegration,
  install: boolean,
): HerdrConfirmation {
  const name = INTEGRATION_NAMES[integration.agent];
  const files = integration.files.length === 0 ? "its configuration" : integration.files.join(", ");
  return install
    ? {
        title: `${integration.state === "outdated" ? "Update" : "Install"} the ${name} integration?`,
        message: `Peer changes ${files} so herdr can resume ${name} agents after a restart.`,
        confirm: integration.state === "outdated" ? "Update" : "Install",
      }
    : {
        title: `Remove the ${name} integration?`,
        message: `Peer changes ${files}. herdr can no longer resume ${name} agents after a restart.`,
        confirm: "Remove",
      };
}

/** The waiting lines under the label, in the words the web uses. */
export function herdrRuntimeNotes(runtime: PeerHerdrRuntime): ReadonlyArray<string> {
  const notes: string[] = [];
  if (runtime.source === "peer" && runtime.otherRunning) {
    notes.push(
      runtime.agents > 0
        ? `Your herdr is running too; Peer keeps using its own until its ${plural(runtime.agents, "agent", "agents")} ${runtime.agents === 1 ? "finishes" : "finish"}`
        : "Your herdr is running too",
    );
  }
  if (runtime.pendingUpgrade === true && runtime.bundledVersion !== undefined) {
    notes.push(
      `herdr ${runtime.bundledVersion} is ready; it starts when your agents finish or when you restart herdr`,
    );
  }
  return notes;
}

/**
 * The kind a launch works in: the chosen checkout's own, else the project's on this computer.
 * An absent `vcs` on a chosen checkout is Git, so it never borrows a sibling's Jujutsu.
 */
export function herdrLaunchVcs(
  chosen: { readonly vcs?: PeerVcsKind | undefined } | undefined,
  ready: ReadonlyArray<{ readonly vcs?: PeerVcsKind | undefined }>,
): PeerVcsKind {
  return chosen === undefined ? projectVcs(ready) : (chosen.vcs ?? "git");
}

/** What a launch makes, in the checkout's words: a branch in a worktree, or a bookmark in a workspace. */
export function herdrLaunchCheckoutText(kind: PeerVcsKind, label: string): string {
  const words = vcsWords(kind);
  return `Peer creates a feature ${words.refNoun} in its own ${words.workspaceNoun}. The agent uses its owner's CLI on ${label}.`;
}

/** Paths an agent left after work: uncommitted under Git, in the working-copy change under jj. */
export function herdrPostHocPathsText(count: number, kind: PeerVcsKind | undefined): string {
  const state = vcsWords(kind).workingTreeDiffLabel.toLowerCase().replace(" ", "-");
  return `${count} ${state} paths observed after work.`;
}
