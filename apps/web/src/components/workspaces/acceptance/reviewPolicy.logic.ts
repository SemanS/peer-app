/**
 * A project's review policy as its Coordination tab shows it: the two rules to pick from, the
 * signals that call a person in words, who set the rule, and whether this person may save another.
 * A Hub that keeps no policy yet says so instead of offering anything.
 */
import { REVIEW_SIGNAL_WORDS } from "@t3tools/client-runtime/peer/handoff";
import {
  PEER_REVIEW_SIGNALS,
  type PeerProjectReviewPolicy,
  type PeerReviewPolicyMode,
  type PeerSetReviewPolicyResult,
} from "@t3tools/contracts";

export const REVIEW_POLICY_CHOICES: ReadonlyArray<{
  readonly value: PeerReviewPolicyMode;
  readonly title: string;
  readonly description: string;
}> = [
  {
    value: "ask",
    title: "Ask a person",
    description: "Every agent’s handoff waits for a person’s review.",
  },
  {
    value: "auto",
    title: "Accept by policy",
    description:
      "An agent’s handoff is accepted when nothing speaks against it. The task stays in review until its work lands.",
  },
];

export const isReviewPolicyMode = (value: unknown): value is PeerReviewPolicyMode =>
  value === "ask" || value === "auto";

/** What speaks against a handoff, in words, in the order the Hub checks it. */
export const REVIEW_SIGNAL_LINES: ReadonlyArray<string> = PEER_REVIEW_SIGNALS.map(
  (signal) => REVIEW_SIGNAL_WORDS[signal],
);

export type ReviewPolicyView =
  | { readonly kind: "loading" }
  | { readonly kind: "older-hub" }
  | {
      readonly kind: "ready";
      readonly mode: PeerReviewPolicyMode;
      readonly version: number;
      /** "Set by Ana · 28 Oct", or "Nobody set a rule yet: a person reviews every handoff." */
      readonly setBy: string;
      readonly canSave: boolean;
    };

/**
 * The section from the read. `mayAct` is a lead of the project or an admin on a connection that may
 * send the save; the Hub decides again.
 */
export function reviewPolicyView(
  read: PeerProjectReviewPolicy | null | undefined,
  mayAct: boolean,
  nameOf: (email: string) => string,
  date: (at: string) => string,
): ReviewPolicyView {
  if (read === null || read === undefined) return { kind: "loading" };
  if (!read.available) return { kind: "older-hub" };
  const { policy } = read;
  return {
    kind: "ready",
    mode: policy.mode,
    version: policy.version,
    setBy:
      policy.version === 0 || policy.updatedBy === undefined
        ? "Nobody set a rule yet: a person reviews every handoff."
        : `Set by ${nameOf(policy.updatedBy)}${policy.updatedAt === undefined ? "" : ` · ${date(policy.updatedAt)}`} (version ${policy.version}).${
            policy.leadLeft === true
              ? " They no longer lead this project, so it accepts nothing until a lead saves it again."
              : ""
          }`,
    canSave: mayAct,
  };
}

/** What a save says: nothing once saved, the rule stored meanwhile when someone saved first. */
export function saveOutcome(
  result: PeerSetReviewPolicyResult,
  nameOf: (email: string) => string,
): string | null {
  if (result.kind === "saved") return null;
  const who = result.policy.updatedBy === undefined ? "Someone" : nameOf(result.policy.updatedBy);
  const rule = REVIEW_POLICY_CHOICES.find((choice) => choice.value === result.policy.mode)?.title;
  return `${who} saved the rule meanwhile: ${rule ?? result.policy.mode}. Nothing of yours was saved; choose again.`;
}
