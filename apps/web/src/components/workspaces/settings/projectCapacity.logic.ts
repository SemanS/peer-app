/**
 * What a project's Capacity page works out of the settings document: the shared budget and the
 * editor that changes it, each person's allocation against it and what they used, the total with
 * its over-budget warning, and what the rule for personal plans allows. Pure, so the page only
 * draws it. The Hub decides every change (design H3); what is here is how the page reads the
 * document, words it, and turns an edit into the writes a draft takes.
 */
import { allocationOf, getAt, planClass } from "@t3tools/client-runtime/peer-settings";
import type { PeerProject } from "@t3tools/contracts";

import { personName, type SettingsPerson } from "./settingsView.logic";
import { formatMoney } from "./shared.logic";

type Mapping = Readonly<Record<string, unknown>>;
const isMapping = (value: unknown): value is Mapping =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const cents = (amount: number) => Math.round(amount * 100) / 100;

/** A write to the draft, at a path below the project's `capacity` node; `undefined` removes the node. */
export interface Edit {
  readonly path: ReadonlyArray<string>;
  readonly value: unknown;
}

// ---- money and periods ---------------------------------------------------------------------------

export const PERIODS = ["day", "week", "month"] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_LABELS: Readonly<Record<Period, string>> = {
  day: "Day",
  week: "Week",
  month: "Month",
};

const PERIOD_WORDS: Readonly<
  Record<Period, { readonly noun: string; readonly a: string; readonly current: string }>
> = {
  day: { noun: "day", a: "a day", current: "today" },
  week: { noun: "week", a: "a week", current: "this week" },
  month: { noun: "month", a: "a month", current: "this month" },
};

export const isPeriod = (value: unknown): value is Period =>
  typeof value === "string" && (PERIODS as ReadonlyArray<string>).includes(value);

/** "month", for "Per month". */
export const periodNoun = (period: Period): string => PERIOD_WORDS[period].noun;

/** `€315 used this month`: what the gateway reports for the period it is in. */
export const usedLine = (spent: number, period: Period, currency: string): string =>
  `${formatMoney(spent, currency)} used ${PERIOD_WORDS[period].current}`;

export type Amount = { readonly ok: true; readonly value: number } | { readonly ok: false };

/**
 * An amount as a person types it: digits with at most two decimals after a `.` or `,` (a trailing
 * separator is fine while typing). The Hub takes zero or more, so nothing else passes.
 */
export function parseAmount(text: string): Amount {
  const trimmed = text.trim();
  if (!/^\d+(?:[.,]\d{0,2})?$/.test(trimmed)) return { ok: false };
  return { ok: true, value: Number(trimmed.replace(",", ".")) };
}

// ---- reading the document ------------------------------------------------------------------------

export type PersonalRule = "any" | "commercial" | "none";

/** A project's shared budget, as the document (or, without settings, the manifest) holds it. */
export interface SharedSettings {
  readonly pool: string;
  readonly amount: number;
  readonly period: Period;
  /** A subset of the pool's models; undefined for all of them. */
  readonly models: ReadonlyArray<string> | undefined;
  /** Address → cap inside the budget. */
  readonly allocations: Readonly<Record<string, number>>;
  /** What everyone without an allocation of their own may use; undefined for no cap. */
  readonly defaultAllocation: number | undefined;
}

export interface CapacitySettings {
  readonly personal: PersonalRule;
  readonly shared: SharedSettings | undefined;
}

function readShared(shared: unknown): SharedSettings | undefined {
  if (!isMapping(shared)) return undefined;
  const pool = shared.pool;
  const amount = getAt(shared, ["budget", "amount"]);
  if (typeof pool !== "string" || !isNumber(amount)) return undefined;
  const period = getAt(shared, ["budget", "period"]);
  const allocations = shared.allocations;
  const models = shared.models;
  return {
    pool,
    amount,
    // The Hub's default, for a budget that names none.
    period: isPeriod(period) ? period : "month",
    models: Array.isArray(models)
      ? models.filter((model): model is string => typeof model === "string")
      : undefined,
    allocations: isMapping(allocations)
      ? Object.fromEntries(
          Object.entries(allocations).flatMap(([email, cap]) =>
            isNumber(cap) ? [[email, cap] as const] : [],
          ),
        )
      : {},
    defaultAllocation: isNumber(shared.defaultAllocation) ? shared.defaultAllocation : undefined,
  };
}

/** A project's `capacity` node (the draft's slice) as the page reads it. */
export function readCapacity(capacity: unknown): CapacitySettings {
  const personal = getAt(capacity, ["personal"]);
  return {
    personal: personal === "commercial" || personal === "none" ? personal : "any",
    shared: readShared(getAt(capacity, ["shared"])),
  };
}

/** What the manifest says of a project's capacity, for the page without settings: no allocations. */
export function capacityFromManifest(capacity: PeerProject["capacity"]): CapacitySettings {
  const { shared } = capacity;
  return {
    personal: capacity.personal,
    shared:
      shared === undefined
        ? undefined
        : {
            pool: shared.pool,
            amount: shared.budget.amount,
            period: shared.budget.period,
            models: shared.models.map((model) => model.id),
            allocations: {},
            defaultAllocation: undefined,
          },
  };
}

/** A model pool of the workspace's catalog. */
export interface PoolOption {
  readonly id: string;
  readonly name: string;
  readonly models: ReadonlyArray<string>;
}

/** The pools the document lists: its `capacity` section, a mapping by pool id. */
export function readPools(document: unknown): ReadonlyArray<PoolOption> {
  const pools = getAt(document, ["capacity"]);
  if (!isMapping(pools)) return [];
  return Object.entries(pools).flatMap(([id, pool]) => {
    if (!isMapping(pool)) return [];
    const models = pool.models;
    return [
      {
        id,
        name: typeof pool.name === "string" && pool.name !== "" ? pool.name : id,
        models: Array.isArray(models)
          ? models.flatMap((model) =>
              isMapping(model) && typeof model.id === "string" ? [model.id] : [],
            )
          : [],
      },
    ];
  });
}

/** "Standard · 2 models", for choosing a pool. */
export const poolLabel = (pool: PoolOption): string =>
  `${pool.name} · ${pool.models.length} ${pool.models.length === 1 ? "model" : "models"}`;

/** Whether the workspace has a gateway, which is what gives a project shared capacity to spend. */
export const hasGateway = (document: unknown): boolean => isMapping(getAt(document, ["gateway"]));

/** A project's models: the subset it names, else every model of its pool. */
export function modelsOf(
  shared: Pick<SharedSettings, "pool" | "models">,
  pools: ReadonlyArray<PoolOption>,
): ReadonlyArray<string> {
  return shared.models ?? pools.find((pool) => pool.id === shared.pool)?.models ?? [];
}

/** The pool's name for "Models · Standard pool"; its id while the catalog does not show it. */
export const poolName = (pool: string, pools: ReadonlyArray<PoolOption>): string =>
  pools.find((candidate) => candidate.id === pool)?.name ?? pool;

// ---- the budget editor ---------------------------------------------------------------------------

/** What the editor holds while it is open: text for the amount, so typing is never rewritten. */
export interface BudgetForm {
  readonly amount: string;
  readonly period: Period;
  readonly pool: string;
}

/** The editor's start: the current budget, or for a project without one an empty amount, a month, the first pool. */
export function budgetFormFor(
  shared: Pick<SharedSettings, "amount" | "period" | "pool"> | undefined,
  pools: ReadonlyArray<PoolOption>,
): BudgetForm {
  return shared === undefined
    ? { amount: "", period: "month", pool: pools[0]?.id ?? "" }
    : { amount: String(shared.amount), period: shared.period, pool: shared.pool };
}

export type BudgetCheck =
  | {
      readonly ok: true;
      readonly amount: number;
      readonly period: Period;
      readonly pool: string;
    }
  | { readonly ok: false; readonly problem: string | null };

/**
 * Whether the form can be Done: an amount of zero or more and a pool of the catalog. The problem is
 * what to say next to the field; there is none while nothing has been typed.
 */
export function checkBudgetForm(form: BudgetForm, pools: ReadonlyArray<PoolOption>): BudgetCheck {
  if (form.amount.trim() === "") return { ok: false, problem: null };
  const amount = parseAmount(form.amount);
  if (!amount.ok) {
    return { ok: false, problem: "The amount is a number, zero or more, like 600 or 12.50." };
  }
  if (!pools.some((pool) => pool.id === form.pool)) {
    return { ok: false, problem: "Pick a model pool." };
  }
  return { ok: true, amount: amount.value, period: form.period, pool: form.pool };
}

/**
 * The writes that make a valid form the project's budget. A project without shared capacity gets it
 * created whole (the Hub fills in the rest); one with it gets only what differs, so a review lists
 * the amount, the period and the pool as the changes they are. Another pool drops the subset of
 * models the old one had, which would name models the new pool does not have.
 */
export function budgetEdits(
  current: SharedSettings | undefined,
  next: Extract<BudgetCheck, { ok: true }>,
): ReadonlyArray<Edit> {
  if (current === undefined) {
    return [
      {
        path: ["shared"],
        value: { pool: next.pool, budget: { amount: next.amount, period: next.period } },
      },
    ];
  }
  const edits: Edit[] = [];
  if (next.amount !== current.amount) {
    edits.push({ path: ["shared", "budget", "amount"], value: next.amount });
  }
  if (next.period !== current.period) {
    edits.push({ path: ["shared", "budget", "period"], value: next.period });
  }
  if (next.pool !== current.pool) {
    edits.push({ path: ["shared", "pool"], value: next.pool });
    if (current.models !== undefined) edits.push({ path: ["shared", "models"], value: undefined });
  }
  return edits;
}

/** Takes the shared budget away again. */
export const removeSharedEdit: Edit = { path: ["shared"], value: undefined };

// ---- allocations ---------------------------------------------------------------------------------

type Person = SettingsPerson;

/**
 * Who a project's members are: the named addresses, or for `*` everyone in the workspace. A named
 * address the people list does not know is called by the part before its `@`.
 */
export function projectMembers(
  project: unknown,
  people: ReadonlyArray<Person>,
): ReadonlyArray<Person> {
  const raw = getAt(project, ["members"]);
  const named = Array.isArray(raw)
    ? raw.filter((member): member is string => typeof member === "string")
    : ["*"];
  const listed: ReadonlyArray<Person> = named.includes("*")
    ? people
    : named.map((email) => ({ email, name: personName(people, { email }) }));
  const seen = new Set<string>();
  return listed.filter(({ email }) => {
    const key = email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** What a person may spend: their own allocation, else the project default, and which it is. */
const allocationFor = (shared: SharedSettings, email: string) =>
  allocationOf({ capacity: { shared } }, email);

/** How much of someone's cap they used: the bar's fill, amber from 85% on. */
export interface UsageBar {
  readonly percent: number;
  readonly warn: boolean;
}

/**
 * Used against a cap. No cap draws an empty bar; a cap of zero that has been spent against is full
 * and amber, since the gateway stops there.
 */
export function usageBar(used: number, cap: number | undefined): UsageBar {
  if (cap === undefined) return { percent: 0, warn: false };
  if (cap <= 0) return used > 0 ? { percent: 100, warn: true } : { percent: 0, warn: false };
  const ratio = used / cap;
  return { percent: Math.min(100, Math.round(ratio * 100)), warn: ratio >= 0.85 };
}

export interface AllocationRow {
  readonly email: string;
  readonly name: string;
  /** Where the cap comes from; null where only the gateway's figure is known (no settings). */
  readonly source: "custom" | "project default" | null;
  /** The cap: the person's own, else the project default; undefined for none. */
  readonly value: number | undefined;
  /** What they spent this period; undefined while usage is not known. */
  readonly used: number | undefined;
  readonly bar: UsageBar | undefined;
}

/** How much the allocations commit against the budget. */
export interface AllocationSummary {
  readonly allocated: number;
  readonly budget: number;
  /** By how much the allocations exceed the budget; 0 while they fit. */
  readonly over: number;
  /** The bar's fill. */
  readonly percent: number;
}

export interface AllocationTable {
  readonly rows: ReadonlyArray<AllocationRow>;
  /** The "Everyone else" row: the project default and who it applies to. */
  readonly everyone: { readonly value: number | undefined; readonly appliesTo: string };
  readonly summary: AllocationSummary;
}

/** "Ana and Vir", "Ana, Vir and Bob", "Ana, Vir, Bob and 3 more". */
export function joinNames(names: ReadonlyArray<string>): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= 4) return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

/**
 * The total the allocations commit, the way the Hub counts it (its warning reads "allocations
 * commit 630 but the budget is 600"): every person's own allocation, and the default for each
 * member without one. A project for the whole workspace counts everyone in it.
 */
export function summarize(
  shared: SharedSettings,
  members: ReadonlyArray<Person>,
): AllocationSummary {
  const withOwn = members.filter(
    (member) => allocationFor(shared, member.email).source === "custom",
  ).length;
  const allocated = cents(
    Object.values(shared.allocations).reduce((sum, cap) => sum + cap, 0) +
      (shared.defaultAllocation ?? 0) * (members.length - withOwn),
  );
  const budget = shared.amount;
  return {
    allocated,
    budget,
    over: cents(Math.max(0, allocated - budget)),
    percent:
      budget > 0 ? Math.min(100, Math.round((allocated / budget) * 100)) : allocated > 0 ? 100 : 0,
  };
}

/**
 * The allocation table: a row for each member, those with an allocation of their own in the saved
 * settings first (the order follows what is saved, so a row does not jump while it is being
 * edited), the "Everyone else" row, and the total. `spent` is each member's use this period by
 * lower-case address, undefined while it is not known.
 */
export function allocationTable({
  shared,
  members,
  savedCustom,
  spent,
}: {
  readonly shared: SharedSettings;
  readonly members: ReadonlyArray<Person>;
  /** Lower-case addresses with an allocation of their own in the saved settings. */
  readonly savedCustom: ReadonlySet<string>;
  readonly spent: ReadonlyMap<string, number> | undefined;
}): AllocationTable {
  const rows = members
    .map((member, index) => {
      const { value, source } = allocationFor(shared, member.email);
      const used = spent === undefined ? undefined : (spent.get(member.email.toLowerCase()) ?? 0);
      const row: AllocationRow = {
        email: member.email,
        name: member.name,
        source,
        value,
        used,
        bar: used === undefined ? undefined : usageBar(used, value),
      };
      return { row, index, first: savedCustom.has(member.email.toLowerCase()) ? 0 : 1 };
    })
    .sort((a, b) => a.first - b.first || a.index - b.index)
    .map(({ row }) => row);
  const others = rows.filter((row) => row.source === "project default").map((row) => row.name);
  return {
    rows,
    everyone: {
      value: shared.defaultAllocation,
      appliesTo: others.length === 0 ? "people added later" : joinNames(others),
    },
    summary: summarize(shared, members),
  };
}

/** The usage the gateway reports for a project member. */
export interface UsageMember {
  readonly id: string;
  readonly name: string;
  readonly allocation: number | null;
  readonly spent: number;
}

/** Rows from the gateway's figures alone, for the page without settings: who may use how much, and what they used. */
export function usageRows(members: ReadonlyArray<UsageMember>): ReadonlyArray<AllocationRow> {
  return members.map((member) => {
    const value = member.allocation ?? undefined;
    return {
      email: member.id,
      name: member.name,
      source: null,
      value,
      used: member.spent,
      bar: usageBar(member.spent, value),
    };
  });
}

/** What each member spent, by lower-case address. */
export const spentBy = (members: ReadonlyArray<UsageMember>): ReadonlyMap<string, number> =>
  new Map(members.map((member) => [member.id.toLowerCase(), member.spent]));

/** The warning under a total that exceeds the budget. */
export function overBudgetText({
  over,
  budget,
  period,
  currency,
  project,
}: {
  readonly over: number;
  readonly budget: number;
  readonly period: Period;
  readonly currency: string;
  readonly project: string;
}): string {
  return `${formatMoney(over, currency)} over the budget. You can save it, but the gateway stops ${project} at ${formatMoney(budget, currency)} ${PERIOD_WORDS[period].a}, so someone runs out first.`;
}

/** The writes that give a member an allocation of their own: the project default's value to start from. */
export const makeCustomEdit = (shared: SharedSettings, email: string): Edit => ({
  path: ["shared", "allocations", email],
  value: shared.defaultAllocation ?? 0,
});

/** The write that sets, or with undefined takes away, a member's own allocation. */
export const allocationEdit = (email: string, value: number | undefined): Edit => ({
  path: ["shared", "allocations", email],
  value,
});

/** Sets, or with undefined takes away, the cap everyone without an allocation of their own gets. */
export const defaultAllocationEdit = (value: number | undefined): Edit => ({
  path: ["shared", "defaultAllocation"],
  value,
});

// ---- personal plans ------------------------------------------------------------------------------

export interface PlanOption {
  readonly value: PersonalRule;
  readonly title: string;
  readonly description: string;
  /** Why the option cannot be chosen; null while it can. */
  readonly reason: string | null;
}

/**
 * The three rules for personal AI plans in a project. Shared capacity only needs shared capacity to
 * stand on, as the Hub's check says (otherwise "nobody can work").
 */
export function planOptions({
  project,
  hasShared,
}: {
  readonly project: string;
  readonly hasShared: boolean;
}): ReadonlyArray<PlanOption> {
  return [
    {
      value: "any",
      title: "Any plan",
      description: "People may use their own plans here, consumer ones too.",
      reason: null,
    },
    {
      value: "commercial",
      title: "Commercial plans only · recommended for client work",
      description: `Team, Enterprise or API plans. Consumer plans like Pro or Max are blocked for ${project}.`,
      reason: null,
    },
    {
      value: "none",
      title: "Shared capacity only",
      description: `Agents in ${project} use only the budget above. Personal logins are blocked.`,
      reason: hasShared ? null : `Needs a shared budget for ${project} first.`,
    },
  ];
}

export const personalEdit = (value: PersonalRule): Edit => ({ path: ["personal"], value });

export const isPersonalRule = (value: unknown): value is PersonalRule =>
  value === "any" || value === "commercial" || value === "none";

/** The plans a person declared in the document: only what their entry holds, which an admin or they themselves see. */
export function plansOf(
  document: unknown,
  email: string,
): ReadonlyArray<{ readonly harness: string; readonly plan: string }> {
  const people = getAt(document, ["people"]);
  if (!isMapping(people)) return [];
  const key = Object.keys(people).find((candidate) => sameAddress(candidate, email));
  const plans = key === undefined ? undefined : getAt(people, [key, "personal"]);
  return Array.isArray(plans)
    ? plans.flatMap((entry) =>
        isMapping(entry) && typeof entry.harness === "string" && typeof entry.plan === "string"
          ? [{ harness: entry.harness, plan: entry.plan }]
          : [],
      )
    : [];
}

/** Who among the members declared plans and only consumer ones (Pro, Max, Plus), by what they are called. */
export function consumerOnlyNames(
  document: unknown,
  members: ReadonlyArray<Person>,
): ReadonlyArray<string> {
  return members
    .filter((member) => {
      const plans = plansOf(document, member.email);
      return plans.length > 0 && plans.every(({ plan }) => planClass(plan) === "consumer");
    })
    .map((member) => member.name);
}

/**
 * The line under the rule: with `any`, that Peer still warns about client work on consumer plans
 * (which it only does for a project with a client); with `commercial`, who it keeps off their own
 * logins, when the document shows their plans. Nothing to say for `none`.
 */
export function personalNote({
  rule,
  hasShared,
  hasClient,
  consumerOnly,
  project,
}: {
  readonly rule: PersonalRule;
  readonly hasShared: boolean;
  readonly hasClient: boolean;
  readonly consumerOnly: ReadonlyArray<string>;
  readonly project: string;
}): string | null {
  if (rule === "any") {
    return hasClient ? "Peer still warns when client work runs on a consumer plan." : null;
  }
  if (rule === "none" || consumerOnly.length === 0) return null;
  const who = joinNames(consumerOnly);
  const verb = consumerOnly.length === 1 ? "has" : "have";
  return hasShared
    ? `${who} ${verb} only consumer plans, so their agents here use the shared budget. A teammate’s request can’t start an agent here unless the rule is Any plan.`
    : `${who} ${verb} only consumer plans, so their agents can’t start in ${project} until it has a shared budget.`;
}
