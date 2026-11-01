/**
 * What the GitHub PR checks card says, apart from how it draws, from GitHub's status.
 */
import type { PeerGitHubStatus } from "@t3tools/contracts";

import { CHECKING, type ConnectionView, type Fact } from "../../settings/connectionFacts";
import type { ConnectionState } from "../../settings/connectionStatus.logic";

/** What the checks do, in the wording of design A6: it promises no more than the Hub does. */
export const GITHUB_DESCRIPTION =
  "When GitHub reports a pull request, its word counts over the agent’s report.";

const GITHUB_OFF_DESCRIPTION =
  "Off: pull requests count as their agents report them. Set it up and GitHub’s word counts over the agent’s report.";

const GITHUB_UNSUPPORTED = "This Hub does not verify pull requests with GitHub.";

const GITHUB_SECRET_CAUSE = "Its secret is not stored, so GitHub’s deliveries are refused.";

/** What turning the checks off says before the review of it. */
export const TURN_OFF_TEXT =
  "Turning off deletes the merges GitHub confirmed. Tasks keep the PRs their agents reported.";

export interface GitHubCardView {
  /** The checks in the status language: the badge, its step or detail, and when GitHub last pinged. */
  readonly connection: ConnectionView;
  readonly description: string;
  readonly canSetUp: boolean;
  /** The wizard's button: "Set up", "Continue setup", "Fix" or "Manage" by where the checks stand. */
  readonly setupLabel: string;
  readonly canTurnOff: boolean;
  /** The checks are on and the secret is not stored: GitHub's deliveries are refused. */
  readonly secretMissing: boolean;
}

/** The repositories on github.com that the checks cover, each once. */
export function coveredRepositories(status: Pick<PeerGitHubStatus, "repositories">): number {
  return new Set(
    status.repositories.flatMap((repository) =>
      repository.github === null ? [] : [repository.github.toLowerCase()],
    ),
  ).size;
}

/**
 * The checks in the status language, from what the Hub reports. Off before they are set up; Needs
 * setup, at the wizard's step, until GitHub's first ping arrives; Connected from then on, as of the
 * last ping; a Problem when GitHub pinged before and the secret that signs its deliveries is gone.
 */
export function githubConnection(status: PeerGitHubStatus): ConnectionView {
  if (status.unsupported === true) return { state: "unavailable", detail: GITHUB_UNSUPPORTED };
  if (!status.configured) return { state: "off", detail: "Agents can’t prove a merge yet." };
  const pinged = status.lastPingAt !== null;
  if (status.secret === "missing" && pinged) {
    return { state: "problem", detail: GITHUB_SECRET_CAUSE };
  }
  if (!pinged) {
    return {
      state: "setup",
      step: { n: 2, of: 3, title: "add the webhook in GitHub, then wait for its ping" },
    };
  }
  const covered = coveredRepositories(status);
  return {
    state: "connected",
    detail: `${covered} ${covered === 1 ? "repository" : "repositories"}`,
    checkedAt: status.lastPingAt ?? undefined,
  };
}

/** The checks' connection while their status is read, failed or here. */
export function githubFactConnection(fact: Fact<PeerGitHubStatus>): ConnectionView {
  if (fact.kind === "loading") return CHECKING;
  if (fact.kind === "failed") return { state: "problem", detail: fact.message };
  return githubConnection(fact.value);
}

const GITHUB_SETUP_LABEL: Readonly<Record<ConnectionState, string>> = {
  unavailable: "",
  off: "Set up",
  setup: "Continue setup",
  connected: "Manage",
  problem: "Fix",
};

export function githubCardView(status: PeerGitHubStatus): GitHubCardView {
  const connection = githubConnection(status);
  if (status.unsupported === true) {
    return {
      connection,
      description: GITHUB_UNSUPPORTED,
      canSetUp: false,
      setupLabel: GITHUB_SETUP_LABEL.unavailable,
      canTurnOff: false,
      secretMissing: false,
    };
  }
  return {
    connection,
    description: status.configured ? GITHUB_DESCRIPTION : GITHUB_OFF_DESCRIPTION,
    canSetUp: true,
    setupLabel: GITHUB_SETUP_LABEL[connection.state],
    canTurnOff: status.configured,
    secretMissing: status.configured && status.secret === "missing",
  };
}

export const GITHUB_SECRET_MISSING = `${GITHUB_SECRET_CAUSE} Make a new one in the setup.`;
