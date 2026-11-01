/**
 * What a project's Coordination page works out of the settings document: the policy its agents
 * follow, and the writes an edit makes to a draft. Pure, so the page only draws it.
 */
import { getAt } from "@t3tools/client-runtime/peer-settings";

/** A write to the draft, at a path below the project's `coordination` node; `undefined` removes the node. */
export interface Edit {
  readonly path: ReadonlyArray<string>;
  readonly value: unknown;
}

export const POLICIES = ["notify", "coordinate", "ask", "exclusive"] as const;
export type Policy = (typeof POLICIES)[number];
export const isPolicy = (value: unknown): value is Policy =>
  typeof value === "string" && (POLICIES as ReadonlyArray<string>).includes(value);

/** The order a rule's policy is chosen from, as the design lists it. */
export const RULE_POLICIES: ReadonlyArray<Policy> = ["exclusive", "coordinate", "ask", "notify"];

/** Each person decides, or one of the policies the project can set. */
export type PolicyChoice = "computer" | Policy;

export const POLICY_CHOICES: ReadonlyArray<{
  readonly value: PolicyChoice;
  readonly title: string;
  readonly description: string;
}> = [
  {
    value: "computer",
    title: "Each person decides",
    description: "Every computer’s own default applies (Settings › This computer).",
  },
  {
    value: "notify",
    title: "notify",
    description: "The agent learns who else is on the file and keeps going.",
  },
  {
    value: "coordinate",
    title: "coordinate",
    description: "The agent waits until it confirms the overlap or leaves a note.",
  },
  {
    value: "ask",
    title: "ask",
    description: "The agent asks its person before it goes on.",
  },
  {
    value: "exclusive",
    title: "exclusive",
    description: "One live session holds the file, like a lock.",
  },
];

export const isPolicyChoice = (value: unknown): value is PolicyChoice =>
  value === "computer" || isPolicy(value);

/** A project's coordination as the document holds it. */
export interface CoordinationSettings {
  /** The project's own policy; undefined where each person decides. A policy this app does not know is kept as it is. */
  readonly policy: string | undefined;
}

/** A project's `coordination` node (the draft's slice) as the page reads it; none says nothing. */
export function readCoordination(coordination: unknown): CoordinationSettings {
  const policy = getAt(coordination, ["policy"]);
  return { policy: typeof policy === "string" ? policy : undefined };
}

/** What the project's own policy is, as the status of an environment says it (no settings to read). */
export const choiceOf = (policy: string | undefined): PolicyChoice | null =>
  policy === undefined ? "computer" : isPolicy(policy) ? policy : null;

/**
 * The write that makes a choice the project's policy: each person decides takes the whole
 * coordination away (a policy is all it holds), another policy sets it.
 */
export const choiceEdit = (choice: PolicyChoice): Edit =>
  choice === "computer" ? { path: [], value: undefined } : { path: ["policy"], value: choice };
