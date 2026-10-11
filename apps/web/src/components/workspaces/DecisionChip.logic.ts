import { pathRuleCount } from "@t3tools/client-runtime/peer/resources";
import {
  decisionParts,
  effectivePolicy,
  type PolicyDecision,
} from "@t3tools/client-runtime/peer-settings";
import type { PeerCoordinationState, PeerHubStatus } from "@t3tools/contracts";

/**
 * What a decision chip says: the policy that decided (in bold), where it came from, and whether
 * the project's path rules were ignored (the chip is then amber).
 */
export interface DecisionChipModel {
  readonly policy: string;
  readonly source: string;
  readonly warn: boolean;
  /** Who set the policy: the project (its policy, or a path rule), this computer, or another one. */
  readonly by: "project" | "computer" | "another";
}

/** What decides in a project when this computer works it out, for a Hub that records no decisions. */
type Coordination = Pick<PeerCoordinationState, "policy" | "policies">;

/**
 * The policy that holds in a project as this computer works it out: the project's own where the
 * Hub said it sets one, else this computer's default. Undefined while the Hub's view of the
 * workspace is not known (not read yet, or an environment from before it was reported), since a
 * missing policy would then read as "the computer decides".
 */
export function projectDecision(
  coordination: Coordination,
  workspace: string,
  project: string,
): PolicyDecision | undefined {
  const policies = coordination.policies?.[workspace];
  if (policies === undefined) return undefined;
  const { value, source } = effectivePolicy(policies, project, coordination.policy);
  return { policy: value, source: source === "project" ? "project" : "client" };
}

/**
 * Whose computer a decision's default is. A project decides for everyone, but a `client` decision
 * is the default of the computer that asked: this one when it says the same policy, else another.
 */
function computerOf(decision: PolicyDecision, computerPolicy: string | undefined) {
  return decision.source === "client" &&
    computerPolicy !== undefined &&
    computerPolicy !== decision.policy
    ? "another"
    : "yours";
}

/**
 * A decision as the Hub recorded it with an overlap or an event, in the words of Work's design:
 * `coordinate · payments/** in Booking`, `ask · your computer, Camp-bot has no policy`, and for a
 * project whose path rules the Hub did not apply, `… · path rules were off` in amber.
 * `computerPolicy` is this computer's default, which tells its own `client` decisions from another's.
 */
export function decisionChip(
  decision: PolicyDecision,
  projectName: string,
  computerPolicy: string | undefined,
): DecisionChipModel {
  const computer = computerOf(decision, computerPolicy);
  const { policy, from, pathRulesOff } = decisionParts(decision, projectName, computer);
  return {
    policy,
    source: pathRulesOff ? `${from} · path rules were off` : from,
    warn: pathRulesOff,
    by: decision.source === "project" ? "project" : computer === "yours" ? "computer" : "another",
  };
}

/**
 * The chip of an overlap: what the Hub recorded for it, else (a Hub that records none) what this
 * computer works out for its project. Null while that is unknown too.
 */
export function overlapChip(
  coordination: Coordination,
  overlap: {
    readonly workspace: string;
    readonly project: string;
    readonly decision?: PolicyDecision | undefined;
  },
  projectName: string,
): DecisionChipModel | null {
  const decision =
    overlap.decision ?? projectDecision(coordination, overlap.workspace, overlap.project);
  return decision === undefined ? null : decisionChip(decision, projectName, coordination.policy);
}

/**
 * The chip of an event of a project's history, which names its decision when the Hub does; an
 * event from before decisions has none, and is not guessed at.
 */
export function eventChip(
  decision: PolicyDecision | undefined,
  projectName: string,
  computerPolicy: string | undefined,
): DecisionChipModel | null {
  return decision === undefined ? null : decisionChip(decision, projectName, computerPolicy);
}

/** The policy line of a project in Work: its chip, its path rules, and where to change it. */
export interface ProjectPolicyLine {
  readonly chip: DecisionChipModel;
  /** How many path rules the project has; 0 while none, or the Hub does not say. */
  readonly rules: number;
  /** The page that changes it: the project's coordination page, or this computer's. */
  readonly change: { readonly label: "Settings" | "Change"; readonly page: "project" | "computer" };
}

/**
 * What a project's header says of its policy: the project's own ("from Booking"), or this
 * computer's default ("from your computer"). Null where no policy applies here (coordination is
 * off on this computer) or the Hub's view of the workspace is not known.
 */
export function projectPolicyLine(
  status: Pick<PeerHubStatus, "coordination" | "resources">,
  workspace: string,
  project: { readonly id: string; readonly name: string },
): ProjectPolicyLine | null {
  if (!status.coordination.enabled) return null;
  const decision = projectDecision(status.coordination, workspace, project.id);
  if (decision === undefined) return null;
  const fromProject = decision.source === "project";
  return {
    chip: {
      policy: decision.policy,
      source: fromProject ? `from ${project.name}` : "from your computer",
      warn: false,
      by: fromProject ? "project" : "computer",
    },
    rules: pathRuleCount(status, workspace, project.id),
    change: fromProject
      ? { label: "Settings", page: "project" }
      : { label: "Change", page: "computer" },
  };
}

/** The count of a project's path rules in words. */
export const pathRulesText = (count: number): string =>
  `${count} path ${count === 1 ? "rule" : "rules"}`;
