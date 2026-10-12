/**
 * What the AI subscriptions page (design artboard 22) works out: the plans a person declared and the
 * writes that edit them into a draft, where each plan may be used, what is left of the shared
 * capacity a project gives them, and the first case where an agent cannot start on a plan, with what
 * to do about it. Pure, so the page only draws it.
 *
 * The plans are information: Peer never sees a login. Which login may start where is decided by
 * `hubPolicy.ts` (and the Hub); `whereUsable` is its twin, and this page only explains the same
 * rules in the person's words: a project that allows `any` takes every plan, `commercial` only
 * Team, Business, Enterprise and API ones, `none` no personal plan, and shared capacity, which is
 * billed to its own project, is there beside them.
 */
import {
  getAt,
  harnessLabel,
  planClass,
  planLabel,
  whereUsable,
  type PersonalPlan,
  type PlanClass,
} from "@t3tools/client-runtime/peer-settings";
import type { PeerHarness, PeerHubProjectUsage, ServerProvider } from "@t3tools/contracts";

import { formatMoney } from "./shared.logic";

type Mapping = Readonly<Record<string, unknown>>;
const isMapping = (value: unknown): value is Mapping =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const sameText = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const cents = (amount: number) => Math.round(amount * 100) / 100;

// ---- the choices -----------------------------------------------------------------------------------

/** The agents a plan can be for, in the order the Hub lists them. */
export const HARNESSES: ReadonlyArray<PeerHarness> = [
  "claude",
  "codex",
  "cursor",
  "grok",
  "opencode",
  "antigravity",
];

export const isHarness = (value: unknown): value is PeerHarness =>
  typeof value === "string" && (HARNESSES as ReadonlyArray<string>).includes(value);

/** The plans the Hub takes. */
export const PLAN_IDS = [
  "pro",
  "max",
  "plus",
  "team",
  "business",
  "enterprise",
  "api",
  "other",
] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const isPlanId = (value: unknown): value is PlanId =>
  typeof value === "string" && (PLAN_IDS as ReadonlyArray<string>).includes(value);

/** The plans grouped by the terms they are under, as the design's plan select shows them. */
export const PLAN_GROUPS: ReadonlyArray<{
  readonly label: string;
  readonly plans: ReadonlyArray<PlanId>;
}> = [
  { label: "Consumer", plans: ["pro", "max", "plus"] },
  { label: "Commercial", plans: ["team", "business", "enterprise", "api"] },
  { label: "Other", plans: ["other"] },
];

/** The badge beside a plan: which kind of terms it is under. */
export const CLASS_LABEL: Readonly<Record<PlanClass, string>> = {
  consumer: "Consumer",
  commercial: "Commercial",
  other: "Other",
};

/** A harness in a chip, where the design says "Claude Max" and "Codex Team". */
export const harnessShort = (harness: string): string =>
  harness === "claude" ? "Claude" : harnessLabel(harness);

/** A plan as a phrase after "your": "Max plan", "API key", "other plan". */
export function planPhrase(plan: string): string {
  switch (plan.toLowerCase()) {
    case "api":
      return "API key";
    case "other":
      return "other plan";
    default:
      return `${planLabel(plan)} plan`;
  }
}

// ---- the plans a person declared -------------------------------------------------------------------

/** One declared plan; `index` is its place in the person's list in the document. */
export interface PlanRow {
  readonly index: number;
  readonly harness: string;
  readonly plan: string;
  readonly kind: PlanClass;
}

/**
 * The plans in a person's entry of the document (`people.<email>`), in its order. An entry that is
 * not a harness and a plan is skipped, but the others keep their place in the list.
 */
export function readPlans(person: unknown): ReadonlyArray<PlanRow> {
  const list = getAt(person, ["personal"]);
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry, index) =>
    isMapping(entry) && typeof entry.harness === "string" && typeof entry.plan === "string"
      ? [{ index, harness: entry.harness, plan: entry.plan, kind: planClass(entry.plan) }]
      : [],
  );
}

/**
 * The key a person has in the document's `people`: the address they are listed under (whatever its
 * case), else the one they sign in with.
 */
export function personKey(document: unknown, email: string): string {
  const people = getAt(document, ["people"]);
  if (!isMapping(people)) return email;
  return Object.keys(people).find((key) => sameText(key, email)) ?? email;
}

/** A write to the draft, at a path below the person's entry; `undefined` removes the node. */
export interface PlanEdit {
  readonly path: ReadonlyArray<string>;
  readonly value: unknown;
}

const listOf = (person: unknown): ReadonlyArray<unknown> => {
  const list = getAt(person, ["personal"]);
  return Array.isArray(list) ? list : [];
};

/**
 * The write that makes `next` the person's plans. The Hub takes the list as one value, so it is
 * written whole. With none left the list is removed, and the person's entry with it unless
 * something else (their name) is in it, so a plan added and taken away again leaves nothing to save.
 */
function writePlans(person: unknown, next: ReadonlyArray<unknown>): PlanEdit {
  if (next.length > 0) return { path: ["personal"], value: next };
  const keeps = isMapping(person) && Object.keys(person).some((key) => key !== "personal");
  return keeps ? { path: ["personal"], value: undefined } : { path: [], value: undefined };
}

/** Whether a plan is in the list already. */
export const hasPlan = (
  plans: ReadonlyArray<{ readonly harness: string; readonly plan: string }>,
  harness: string,
  plan: string,
): boolean => plans.some((row) => sameText(row.harness, harness) && sameText(row.plan, plan));

/** The write that adds a plan, or null where the same one is there. Entries already in the list stay as they are. */
export function addPlanEdit(person: unknown, harness: string, plan: string): PlanEdit | null {
  if (hasPlan(readPlans(person), harness, plan)) return null;
  return writePlans(person, [...listOf(person), { harness, plan }]);
}

/** The write that takes the plan at `index` of the list away; null where there is none. */
export function removePlanEdit(person: unknown, index: number): PlanEdit | null {
  const list = listOf(person);
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return null;
  return writePlans(
    person,
    list.filter((_, at) => at !== index),
  );
}

/**
 * The agent the add row starts on: the first with no plan yet, so a person adding their second plan
 * is not offered the first again. Claude Code once every agent has one.
 */
export function nextHarness(plans: ReadonlyArray<{ readonly harness: string }>): PeerHarness {
  return (
    HARNESSES.find((harness) => !plans.some((plan) => sameText(plan.harness, harness))) ?? "claude"
  );
}

// ---- the plans the agents report -------------------------------------------------------------------

/** The agents whose status names a plan: the driver that runs each, and how it words one. */
const REPORTING: Readonly<
  Record<string, { readonly harness: PeerHarness; readonly rules: ReadonlyArray<PlanRule> }>
> = {
  claudeAgent: {
    harness: "claude",
    rules: [
      [/\bapi key\b/i, "api"],
      [/\bmax\b/i, "max"],
      [/\bpro\b/i, "pro"],
      [/\bteam\b/i, "team"],
      [/\benterprise\b/i, "enterprise"],
      [/\bbusiness\b/i, "business"],
      [/\bfree\b/i, null],
      [/\bsubscription\b/i, "other"],
    ],
  },
  codex: {
    harness: "codex",
    rules: [
      [/\bapi key\b/i, "api"],
      [/\bplus\b/i, "plus"],
      [/\bpro\b/i, "pro"],
      [/\bteam\b/i, "team"],
      [/\benterprise\b/i, "enterprise"],
      [/\bbusiness\b/i, "business"],
      [/\bfree\b/i, null],
      [/\bsubscription\b/i, "other"],
    ],
  },
};

/** A pattern in an agent's own words for a plan, and the plan it is; null for what is no plan to bring (Free). */
type PlanRule = readonly [RegExp, PlanId | null];

/** One plan an agent on this computer reports, offered to be added as the person's own. */
export interface DetectedPlan {
  readonly harness: PeerHarness;
  readonly plan: PlanId;
  /** What the agent said, as it said it: "Claude Max Subscription". Never an account or a login. */
  readonly reported: string;
  /** What "Not mine" is remembered by. Plans, not words: a plan that changes is offered again. */
  readonly key: string;
}

export const detectedPlanKey = (harness: string, plan: string) => `${harness}:${plan}`;

/** The plan an agent's auth label names, or null where it names none (not signed in, Free, a cloud account). */
function planOfLabel(label: string, rules: ReadonlyArray<PlanRule>): PlanId | null {
  return rules.find(([pattern]) => pattern.test(label))?.[1] ?? null;
}

/**
 * The plans the agents report that the person could add: what each signed-in Claude Code and Codex
 * says it runs on, once per plan however many instances report it, leaving out those already in
 * their list and those they said are not theirs. Hidden ones are returned apart so the page can
 * offer them back. Only what the status says counts: a plan is never worked out from anything else,
 * and nothing here reads an account.
 */
export function detectedPlans(
  providers: ReadonlyArray<ServerProvider>,
  plans: ReadonlyArray<{ readonly harness: string; readonly plan: string }>,
  dismissed: ReadonlyArray<string>,
): { readonly offered: ReadonlyArray<DetectedPlan>; readonly hidden: ReadonlyArray<DetectedPlan> } {
  const found = new Map<string, DetectedPlan>();
  for (const provider of providers) {
    const reporting = REPORTING[provider.driver];
    const label = provider.auth.label;
    if (
      reporting === undefined ||
      label === undefined ||
      !provider.installed ||
      provider.auth.status !== "authenticated" ||
      provider.auth.subscriptionSharing === true
    )
      continue;
    const plan = planOfLabel(label, reporting.rules);
    if (plan === null) continue;
    const key = detectedPlanKey(reporting.harness, plan);
    if (!found.has(key)) found.set(key, { harness: reporting.harness, plan, reported: label, key });
  }
  const open = [...found.values()].filter(
    (detected) => !hasPlan(plans, detected.harness, detected.plan),
  );
  return {
    offered: open.filter((detected) => !dismissed.includes(detected.key)),
    hidden: open.filter((detected) => dismissed.includes(detected.key)),
  };
}

// ---- where a plan may be used ----------------------------------------------------------------------

/** A project as the manifest gives it to the person on it. */
export interface UseProject {
  readonly id: string;
  readonly name: string;
  readonly client?: string | undefined;
  readonly capacity: {
    readonly personal: string;
    /** The agents the person declared a seat under commercial terms for (the Hub's reading of their plans). */
    readonly personalHarnesses: ReadonlyArray<string>;
    readonly shared?:
      | {
          /** What the person may spend of the budget: their allocation, when they have one. */
          readonly allocation?: number | undefined;
          readonly budget: { readonly amount: number; readonly period: string };
        }
      | undefined;
  };
}

export type ChipTone = "allowed" | "blocked" | "shared";

/** One chip of a project's row: `Claude Max · blocked here`, `Codex Team · allowed`, `Shared · €88 of €150 left`. */
export interface UseChip {
  readonly key: string;
  readonly label: string;
  readonly state: string;
  readonly tone: ChipTone;
  /** The plan it is about, for the chips of plans. */
  readonly plan?: { readonly harness: string; readonly plan: string };
  /** Why it is blocked. */
  readonly reason?: string;
}

/** What a person may spend of a project's shared capacity, before the gateway's figures are known. */
export interface SharedFigures {
  /** Their allocation; undefined for no cap of their own: the whole budget. */
  readonly cap: number | undefined;
  readonly budget: number;
  readonly period: string;
}

export interface UseRow {
  readonly project: string;
  readonly name: string;
  readonly rule: "any" | "commercial" | "none";
  readonly ruleText: string;
  /** The chips of their own plans; the shared chip follows once the page has the gateway's figures. */
  readonly chips: ReadonlyArray<UseChip>;
  readonly shared: SharedFigures | null;
  /** What the row says while it has no chip at all. */
  readonly emptyText: string | null;
}

const RULES: Readonly<Record<"any" | "commercial" | "none", string>> = {
  any: "Any plan",
  commercial: "Commercial plans only",
  none: "Shared capacity only",
};

/** The rule a project states for personal plans; one this app does not know is read as any, as the Hub does. */
const ruleOf = (personal: string): "any" | "commercial" | "none" =>
  personal === "commercial" || personal === "none" ? personal : "any";

/** What a project allows of personal plans, as a sentence: the reason a blocked plan gives, without the plan. */
function ruleSentence(project: UseProject, rule: "commercial" | "none"): string {
  if (rule === "none") return `${project.name} runs on shared capacity only.`;
  const work = project.client === undefined ? "" : `is client work for ${project.client} and `;
  return `${project.name} ${work}allows commercial plans only.`;
}

/** The figures of a project's shared capacity for the person; null where the project has none. */
export function sharedFigures(project: UseProject): SharedFigures | null {
  const { shared } = project.capacity;
  if (shared === undefined) return null;
  return { cap: shared.allocation, budget: shared.budget.amount, period: shared.budget.period };
}

const blockedPersonal = (label: string, reason: string): UseChip => ({
  key: "personal",
  label,
  state: "blocked here",
  tone: "blocked",
  reason,
});

/** The chips of the plans a person declared, where each is allowed and why a blocked one is not. */
function chipsOfPlans(
  project: UseProject,
  plans: ReadonlyArray<PersonalPlan>,
): ReadonlyArray<UseChip> {
  // One project at a time: an object keyed by ids would put a numeric id before the others.
  const [use] = whereUsable(
    {
      [project.id]: {
        name: project.name,
        client: project.client,
        capacity: { personal: project.capacity.personal, shared: project.capacity.shared },
      },
    },
    plans,
  );
  if (use === undefined) return [];
  // Shared capacity only blocks every personal login, whatever the plan: one chip says so.
  if (use.rule === "none") {
    return [
      blockedPersonal("Personal plans", use.plans[0]?.reason ?? ruleSentence(project, "none")),
    ];
  }
  return use.plans.map((plan, index) => ({
    key: `${index}:${plan.harness}:${plan.plan}`,
    label: `${harnessShort(plan.harness)} ${planLabel(plan.plan)}`,
    state: plan.usable ? "allowed" : "blocked here",
    tone: plan.usable ? ("allowed" as const) : ("blocked" as const),
    plan: { harness: plan.harness, plan: plan.plan },
    ...(plan.reason === undefined ? {} : { reason: plan.reason }),
  }));
}

/**
 * The chips when the plans are not known (a Hub that does not share them): the manifest says which
 * agents the person has a commercial seat for, which is what `hubPolicy.ts` falls back to for a
 * login it cannot read, and nothing about the rest.
 */
function chipsOfHarnesses(
  project: UseProject,
  rule: "any" | "commercial" | "none",
): ReadonlyArray<UseChip> {
  if (rule === "none") return [blockedPersonal("Personal plans", ruleSentence(project, "none"))];
  if (rule === "any") {
    return [{ key: "personal", label: "Your own plans", state: "allowed", tone: "allowed" }];
  }
  if (project.capacity.personalHarnesses.length === 0) {
    return [blockedPersonal("Your own plans", ruleSentence(project, "commercial"))];
  }
  // The plan behind each is not known, so none is named: nothing here can offer another plan.
  return project.capacity.personalHarnesses.map((harness) => ({
    key: harness,
    label: harnessShort(harness),
    state: "allowed",
    tone: "allowed" as const,
  }));
}

/**
 * Where the person may use their plans, for each project they are on, in the manifest's order.
 * With `plans` null (not known) a row says what the manifest knows. A row with no chip at all says
 * what would give it one.
 */
export function whereYouCanUse(
  projects: ReadonlyArray<UseProject>,
  plans: ReadonlyArray<PersonalPlan> | null,
): ReadonlyArray<UseRow> {
  return projects.map((project) => {
    const rule = ruleOf(project.capacity.personal);
    const chips = plans === null ? chipsOfHarnesses(project, rule) : chipsOfPlans(project, plans);
    const shared = sharedFigures(project);
    return {
      project: project.id,
      name: project.name,
      rule,
      ruleText: RULES[rule],
      chips,
      shared,
      emptyText:
        chips.length > 0 || shared !== null
          ? null
          : rule === "commercial"
            ? "Add a Team, Business, Enterprise or API plan to use your own login here."
            : "Add a plan to see where it works.",
    };
  });
}

// ---- the shared capacity ---------------------------------------------------------------------------

/** The shared part of a project's usage, as the gateway reports it for the period. */
export type SharedUsage = NonNullable<PeerHubProjectUsage["shared"]>;

/** A person's shared capacity in a project with what the gateway reports of its use; absent figures are undefined. */
export interface SharedUse extends SharedFigures {
  /** What the person spent this period. */
  readonly spent: number | undefined;
  /** What the whole project spent. */
  readonly teamSpent: number | undefined;
}

/**
 * The figures of the person's share, with the gateway's use when it is known. The gateway's own
 * word for the person's allocation wins, since it is what their spending is counted against.
 */
export function sharedUse(
  figures: SharedFigures,
  usage: SharedUsage | null,
  email: string | null,
): SharedUse {
  const mine =
    usage === null || email === null
      ? undefined
      : usage.members.find((member) => sameText(member.id, email));
  return {
    cap: mine === undefined ? figures.cap : (mine.allocation ?? undefined),
    budget: figures.budget,
    period: figures.period,
    spent: mine?.spent,
    teamSpent: usage?.spent,
  };
}

/**
 * What is left to spend, and out of what: of the person's allocation, or without one of the
 * project's budget. Undefined while the gateway's figures are not known.
 */
export function sharedLeft(
  use: SharedUse,
): { readonly left: number; readonly of: number; readonly own: boolean } | undefined {
  if (use.cap !== undefined) {
    return use.spent === undefined
      ? undefined
      : { left: Math.max(0, cents(use.cap - use.spent)), of: use.cap, own: true };
  }
  return use.teamSpent === undefined
    ? undefined
    : { left: Math.max(0, cents(use.budget - use.teamSpent)), of: use.budget, own: false };
}

/** `Shared · €88 of €150 left`: the person's share, or before the gateway answers what they are given. */
export function sharedChip(use: SharedUse, currency: string): UseChip {
  const left = sharedLeft(use);
  const state =
    left !== undefined
      ? `${formatMoney(left.left, currency)} of ${formatMoney(left.of, currency)} left${left.own ? "" : " in the project budget"}`
      : use.cap !== undefined
        ? `${formatMoney(use.cap, currency)} allocated`
        : `${formatMoney(use.budget, currency)} per ${use.period}`;
  return { key: "shared", label: "Shared", state, tone: "shared" };
}

// ---- when an agent cannot start on a plan -----------------------------------------------------------

/** The first case where a plan is blocked: what to tell the person, and what they could do instead. */
export interface BlockedCase {
  readonly project: string;
  readonly projectName: string;
  readonly title: string;
  readonly reason: string;
  /** Another plan of theirs the project allows. */
  readonly alternative: { readonly harness: string; readonly plan: string } | null;
  /** The project's shared capacity for the person, where it has any. */
  readonly shared: SharedFigures | null;
}

/**
 * The first blocked case in the order of the projects. A plan is named in the title ("Claude Code
 * can’t use your Max plan in Booking") and a project that blocks every personal plan says so of
 * them all. The alternative is the first other plan the same project allows.
 */
export function firstBlocked(rows: ReadonlyArray<UseRow>): BlockedCase | null {
  for (const row of rows) {
    const blocked = row.chips.find((chip) => chip.tone === "blocked");
    if (blocked === undefined) continue;
    const alternative =
      row.chips.find((chip) => chip.tone === "allowed" && chip.plan !== undefined)?.plan ?? null;
    return {
      project: row.project,
      projectName: row.name,
      title:
        blocked.plan === undefined
          ? `Your own plans can’t be used in ${row.name}`
          : `${harnessLabel(blocked.plan.harness)} can’t use your ${planPhrase(blocked.plan.plan)} in ${row.name}`,
      reason: blocked.reason ?? `${row.name} does not allow it.`,
      alternative,
      shared: row.shared,
    };
  }
  return null;
}

/** "Use Codex on your Team plan". */
export const alternativeLabel = (plan: { readonly harness: string; readonly plan: string }) =>
  `Use ${harnessLabel(plan.harness)} on your ${planPhrase(plan.plan)}`;

/** "Use Booking’s shared budget · €88 left", with what is left once the gateway has said. */
export function sharedActionLabel(project: string, use: SharedUse, currency: string): string {
  const left = sharedLeft(use);
  return `Use ${project}’s shared budget${left === undefined ? "" : ` · ${formatMoney(left.left, currency)} left`}`;
}

/** What a button of the card does, under it: it leads to where an agent starts, it does not start one. */
export function actionNote(input: {
  readonly kind: "alternative" | "shared";
  readonly project: string;
  readonly harness?: string;
  /** Shared capacity is turned on for this computer. */
  readonly sharedOnHere?: boolean;
}): string {
  if (input.kind === "alternative") {
    return `Opens a new thread in ${input.project}. Pick ${harnessLabel(input.harness ?? "")} in its model picker.`;
  }
  return input.sharedOnHere === true
    ? `Opens a new thread in ${input.project}. Pick its shared capacity in the model picker.`
    : `Opens ${input.project}’s Capacity page, where you turn its shared capacity on for this computer.`;
}

/** What the card's place says while nothing is blocked. */
export function nothingBlockedText(input: {
  readonly projects: number;
  /** How many plans the person declared; null where they are not known. */
  readonly plans: number | null;
}): string {
  if (input.projects === 0) return "You’re not on a project here yet.";
  if (input.plans === null) return "Nothing is blocked in your projects.";
  if (input.plans === 0) return "Add a plan above to see where an agent can start on it.";
  return "Nothing is blocked: your plans work in every project you’re on.";
}

/** What a card with no way out says: a plan the project allows, or someone who changes the rule. */
export const noWayOutText = (project: string): string =>
  `Add a Team, Business, Enterprise or API plan above, or ask ${project}’s leads to allow more.`;
