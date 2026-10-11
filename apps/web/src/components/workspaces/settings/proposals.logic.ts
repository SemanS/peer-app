/**
 * What the proposals on a settings page say, apart from how they draw: which page a proposal
 * belongs to, who has to decide it, the banner's words, and the line that says who proposed it.
 * Agents propose and owners save (design H7), so a person meets proposals as one who decides them
 * (the owner of what they touch) or as the one who made them.
 */
import { harnessLabel } from "@t3tools/client-runtime/peer-settings";
import type { PeerSettingsProposal } from "@t3tools/contracts";

import type { PeerSettingsLocation } from "./peerSettings.logic";

/** The longest reason a decline may give (the Hub's limit). */
export const DECLINE_MAX = 300;

/** What a page shows proposals for: a workspace, and the scope of the Hub's vocabulary within it. */
export interface ProposalPage {
  readonly workspace: string;
  /** `workspace`, `project:<id>` or `person:<email>`. */
  readonly scope: string;
}

/**
 * The proposals a page shows: a project's pages those that touch the project, a workspace's own
 * pages those that touch the workspace, AI subscriptions those that touch the person. Keys, Slack
 * and the computer's pages have no settings to propose changes to.
 */
export function proposalPageOf(
  location: PeerSettingsLocation | null,
  email: string | null,
): ProposalPage | null {
  if (location === null || location.kind === "computer") return null;
  if (location.kind === "project") {
    return { workspace: location.workspace, scope: `project:${location.projectId}` };
  }
  switch (location.section) {
    case "keys":
    case "slack":
      return null;
    case "plans":
      return email === null ? null : { workspace: location.workspace, scope: `person:${email}` };
    default:
      return { workspace: location.workspace, scope: "workspace" };
  }
}

const sameScope = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * The pending proposals that belong on a page, newest first. A proposal that touches nothing, an
 * ask to the admins, belongs on the workspace's pages.
 */
export function proposalsOnPage(
  proposals: ReadonlyArray<PeerSettingsProposal>,
  scope: string,
): ReadonlyArray<PeerSettingsProposal> {
  return proposals
    .filter(
      (proposal) =>
        proposal.state === "pending" &&
        (proposal.scopes.some((candidate) => sameScope(candidate, scope)) ||
          (scope === "workspace" && proposal.scopes.length === 0)),
    )
    .toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** How long a proposer is shown what became of a proposal of theirs. */
export const DECIDED_SHOWN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The person's own proposals on a page that an owner saved or declined, or that expired, in the
 * last week, newest first: the proposer learns what became of them where they made them.
 */
export function decidedOnPage(
  proposals: ReadonlyArray<PeerSettingsProposal>,
  scope: string,
  now: number,
): ReadonlyArray<PeerSettingsProposal> {
  const when = (proposal: PeerSettingsProposal) => Date.parse(proposal.decidedAt ?? proposal.at);
  return proposals
    .filter(
      (proposal) =>
        proposal.mine &&
        ["applied", "declined", "expired"].includes(proposal.state) &&
        now - when(proposal) < DECIDED_SHOWN_MS &&
        (proposal.scopes.some((candidate) => sameScope(candidate, scope)) ||
          (scope === "workspace" && proposal.scopes.length === 0)),
    )
    .toSorted((a, b) => when(b) - when(a));
}

/** "Saved by Slavo in revision 44", "Declined by Slavo: Not this sprint", "Expired undecided". */
export function decisionText(
  proposal: Pick<PeerSettingsProposal, "state" | "revision" | "reason">,
  decider: string | null,
): string {
  const by = decider === null ? "" : ` by ${decider}`;
  switch (proposal.state) {
    case "applied":
      return typeof proposal.revision === "number"
        ? `Saved${by} in revision ${proposal.revision}`
        : `Done${by}`;
    case "declined": {
      const reason = proposal.reason?.trim() ?? "";
      return `Declined${by}${reason === "" ? "" : `: ${reason}`}`;
    }
    case "expired":
      return "Expired undecided after 30 days";
    default:
      return proposal.state;
  }
}

/** The ones the person decides, and their own that wait on others. */
export function splitProposals(proposals: ReadonlyArray<PeerSettingsProposal>) {
  return {
    deciding: proposals.filter((proposal) => proposal.canDecide),
    waiting: proposals.filter((proposal) => proposal.mine && !proposal.canDecide),
  };
}

/**
 * "2 proposals wait for you", "Your proposal waits for Booking's leads and admins", "Your proposal
 * was decided", or several of them; null for none.
 */
export function bannerText(
  deciding: ReadonlyArray<PeerSettingsProposal>,
  waiting: ReadonlyArray<PeerSettingsProposal>,
  decided: ReadonlyArray<PeerSettingsProposal> = [],
): string | null {
  const parts: string[] = [];
  if (deciding.length > 0) {
    parts.push(
      deciding.length === 1
        ? "1 proposal waits for you"
        : `${deciding.length} proposals wait for you`,
    );
  }
  if (waiting.length > 0) {
    const owners = [...new Set(waiting.map((proposal) => proposal.owners))];
    const who = owners.length === 1 && owners[0] !== undefined ? owners[0] : "their owners";
    parts.push(
      waiting.length === 1
        ? `Your proposal waits for ${who}`
        : `Your ${waiting.length} proposals wait for ${who}`,
    );
  }
  if (decided.length > 0) {
    parts.push(
      decided.length === 1
        ? "Your proposal was decided"
        : `${decided.length} of your proposals were decided`,
    );
  }
  return parts.length === 0 ? null : parts.join(" · ");
}

/** "Codex for Ana": the agent that proposed it for the person who asked it to, or just the person. */
export function proposerText(proposal: Pick<PeerSettingsProposal, "via">, name: string): string {
  const agent = proposal.via?.kind === "agent" ? proposal.via.agent : undefined;
  return agent === undefined || agent === "" ? name : `${harnessLabel(agent)} for ${name}`;
}

/** The line over a proposal's review: "Proposed by Codex for Ana: Migrations must not run twice". */
export function proposedByText(
  proposal: Pick<PeerSettingsProposal, "via" | "message">,
  name: string,
): string {
  const who = proposerText(proposal, name);
  const why = proposal.message.trim();
  return `Proposed by ${who}${why === "" ? "" : `: ${why}`}`;
}
