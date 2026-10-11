/**
 * What the GitHub PR checks wizard says and waits for, apart from how it draws (design artboard
 * 20): the three steps, the fields GitHub needs from the Hub, and how the wizard knows GitHub's
 * ping arrived. The Hub does the work: turning the checks on stores the secret (shown once) and the
 * workspace's `github` block, and GitHub's first delivery is its ping.
 */
import type { PeerGitHubStatus, PeerSettingsGitHubSetup } from "@t3tools/contracts";

import { joinNames } from "./reviewChanges.logic";

/** The steps, in order; the wizard's step is an index into this. */
export const WIZARD_STEPS = ["Turn on", "Add it in GitHub", "Wait for the ping"] as const;
export type WizardStep = 0 | 1 | 2;

/**
 * Where the wizard opens: a workspace with the checks on starts at the webhook GitHub needs (to see
 * it again, or to rotate its secret); one without starts at turning them on.
 */
export const startingStep = (status: Pick<PeerGitHubStatus, "configured"> | null): WizardStep =>
  status !== null && status.configured ? 1 : 0;

/** What the checks do, which step one says before it turns them on (design A6 wording). */
export const TURN_ON_TEXT =
  "When it’s on, GitHub’s word on a pull request counts over the agent’s report, and Work shows each PR as merged, closed or open.";

/** What the checks cover: the repositories on github.com, which are the only ones GitHub reports on. */
export function worksForText(status: Pick<PeerGitHubStatus, "repositories">): string {
  const covered = [
    ...new Set(
      status.repositories
        .filter((repository) => repository.github !== null)
        .map((repository) => repository.repository),
    ),
  ];
  const outside = status.repositories.filter((repository) => repository.github === null).length;
  const rest =
    outside === 0
      ? ""
      : ` The ${outside === 1 ? "one" : outside} outside github.com stay${outside === 1 ? "s" : ""} as their agents report ${outside === 1 ? "it" : "them"}.`;
  if (covered.length === 0) {
    return `None of the workspace’s repositories are on github.com yet.${rest}`;
  }
  return `Works for repositories on github.com: ${joinNames(covered)}.${rest}`;
}

/** How the Hub names the events GitHub should send. */
export const eventsText = (events: string): string =>
  events === "pull_request" ? "Pull requests only" : events;

/** One row of what to enter in GitHub. */
export interface SetupField {
  readonly label: string;
  readonly value: string;
  /** The row has a Copy button. */
  readonly copy: boolean;
  /** The value is not one to copy: the secret, kept sealed. */
  readonly sealed: boolean;
}

/** The Hub's answer has the secret itself: it is in the answer that made one, and only there. */
export const secretShown = (setup: Pick<PeerSettingsGitHubSetup, "secret">): boolean =>
  typeof setup.secret === "string" && setup.secret !== "";

/**
 * What GitHub asks for, from the Hub's answer: where to send, how, with which secret and which
 * events. The secret is in the answer once; asked again the Hub says only that it keeps one.
 */
export function setupFields(setup: PeerSettingsGitHubSetup): ReadonlyArray<SetupField> {
  const secret = secretShown(setup) ? (setup.secret ?? "") : null;
  return [
    { label: "Payload URL", value: setup.payloadUrl, copy: true, sealed: false },
    { label: "Content type", value: "application/json", copy: false, sealed: false },
    {
      label: "Secret",
      value: secret ?? `Sealed as ${setup.secretName}`,
      copy: secret !== null,
      sealed: secret === null,
    },
    { label: "Events", value: eventsText(setup.events), copy: false, sealed: false },
  ];
}

/** The line under the fields, in the warning's place while the secret is on screen. */
export const secretNote = (
  setup: Pick<PeerSettingsGitHubSetup, "secret" | "secretName">,
): string =>
  secretShown(setup)
    ? `The secret is shown only now. Peer keeps it sealed as ${setup.secretName}.`
    : `The secret stays sealed as ${setup.secretName}. Rotate it to get a new one.`;

/** What rotating the secret does, which is asked before it does it. */
export const ROTATE_WARNING =
  "Rotating makes a new secret. GitHub’s deliveries are refused until the new one is set in GitHub too.";

export const WAITING_TEXT =
  "Waiting for GitHub’s ping. GitHub sends one as soon as the webhook is saved.";

/**
 * Whether GitHub's ping has arrived since the wizard started waiting: the status has a ping that is
 * not the one it had then (`baseline`, null for none). Times are the Hub's own, so the wizard
 * compares them with each other and never with this computer's clock.
 */
export function pingArrived(
  baseline: string | null,
  status: Pick<PeerGitHubStatus, "lastPingAt">,
): boolean {
  return status.lastPingAt !== null && status.lastPingAt !== baseline;
}

/** "Ping received from acme at 12:10. PR checks are on." */
export function pingText(workspace: string, at: string, clock: (iso: string) => string): string {
  const time = clock(at);
  return `Ping received from ${workspace}${time === "" ? "" : ` at ${time}`}. PR checks are on.`;
}

/** How often the wizard asks the Hub whether the ping came, while it is waiting. */
export const POLL_MS = 4_000;
