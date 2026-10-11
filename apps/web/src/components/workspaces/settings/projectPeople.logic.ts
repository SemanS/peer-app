/**
 * What a project's People tab shows and changes, apart from how it draws (design artboard 04): the
 * people table read from the project's entry of the settings document and the workspace's people,
 * the edits that become the draft's members, leads and allocations, and the sentences around them.
 *
 * A project's `members` is `["*"]` for the whole workspace or the addresses it names; `leads` are
 * addresses that must be among the members unless the whole workspace is on it, which the Hub's
 * check enforces. An allocation belongs to a member too, so taking a person off the project takes
 * their custom allocation with them.
 */
import { allocationOf, getAt } from "@t3tools/client-runtime/peer-settings";

import { personName } from "./settingsView.logic";
import { formatMoney } from "./shared.logic";

/** A person of the workspace, as the settings view lists them. */
export interface WorkspacePerson {
  readonly email: string;
  readonly name: string;
}

export type WhoMode = "all" | "selected";

type Mapping = Readonly<Record<string, unknown>>;

const isMapping = (value: unknown): value is Mapping =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const textsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const includesAddress = (list: ReadonlyArray<string>, email: string) =>
  list.some((item) => sameAddress(item, email));

const withoutAddress = (list: ReadonlyArray<string>, email: string): string[] =>
  list.filter((item) => !sameAddress(item, email));

/** The addresses once each, in the order they first appear. */
function uniqueAddresses(list: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  return list.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---- reading the project's entry ----------------------------------------------------------------

/**
 * Who a project names: `["*"]` for the whole workspace, else addresses. An entry without the key
 * takes everyone, as the Hub reads it; something that is not an entry names no one.
 */
export function membersOf(entry: unknown): string[] {
  if (!isMapping(entry)) return [];
  return Object.hasOwn(entry, "members") ? textsOf(entry.members) : ["*"];
}

export const leadsOf = (entry: unknown): string[] => textsOf(getAt(entry, ["leads"]));

export const modeOf = (members: ReadonlyArray<string>): WhoMode =>
  members.includes("*") ? "all" : "selected";

interface Shared {
  readonly allocations: Readonly<Record<string, number>>;
  readonly defaultAllocation?: number;
}

/** The project's shared capacity as far as allocations go; undefined where it has none. */
function sharedOf(entry: unknown): Shared | undefined {
  const shared = getAt(entry, ["capacity", "shared"]);
  if (!isMapping(shared)) return undefined;
  const raw = shared.allocations;
  const allocations = isMapping(raw)
    ? Object.fromEntries(
        Object.entries(raw).filter((pair): pair is [string, number] => typeof pair[1] === "number"),
      )
    : {};
  const fallback = shared.defaultAllocation;
  return typeof fallback === "number"
    ? { allocations, defaultAllocation: fallback }
    : { allocations };
}

// ---- the table ----------------------------------------------------------------------------------

export interface PeopleRow {
  readonly email: string;
  readonly name: string;
  readonly you: boolean;
  /** Null where nothing says who leads (the manifest names only the person's own part). */
  readonly lead: boolean | null;
  /** What the person may spend, and whose rule that is; null where the project has no shared capacity. */
  readonly allocation: {
    readonly text: string;
    readonly source: "custom" | "project default";
  } | null;
}

export interface PeopleModel {
  /** Whole workspace or named people; null where only the manifest says who is on it. */
  readonly mode: WhoMode | null;
  readonly rows: ReadonlyArray<PeopleRow>;
  /** Everyone on the project: the workspace's people for the whole workspace, else the rows. */
  readonly count: number;
  /** For the whole workspace: people on the project that the rows do not list. */
  readonly more: number;
}

function allocationOfRow(
  shared: Shared | undefined,
  email: string,
  currency: string,
): PeopleRow["allocation"] {
  if (shared === undefined) return null;
  const { value, source } = allocationOf({ capacity: { shared } }, email);
  return { text: value === undefined ? "No cap" : formatMoney(value, currency), source };
}

/**
 * The people table. With the project's entry of the document it lists, leads first, the people the
 * project names (all of its members, or for the whole workspace its leads and those with a custom
 * allocation, the rest being counted in `more`), each with their allocation and where it comes
 * from. Without it only the manifest's members are listed, and nothing of their roles.
 */
export function peopleModel(input: {
  readonly entry: unknown;
  /** The workspace's people, who names and the whole workspace's size come from. */
  readonly people: ReadonlyArray<WorkspacePerson>;
  readonly me: string | null;
  readonly currency: string;
  /** What the manifest says, for a Hub or a moment without the document. */
  readonly manifest: {
    readonly members: ReadonlyArray<{ readonly email: string; readonly name: string }>;
    readonly role: "lead" | "member";
  };
}): PeopleModel {
  const { entry, people, me, currency } = input;
  const isMe = (email: string) => me !== null && sameAddress(email, me);
  if (!isMapping(entry)) {
    const rows = input.manifest.members.map((person) => ({
      email: person.email,
      name: personName(people, person),
      you: isMe(person.email),
      lead: isMe(person.email) ? input.manifest.role === "lead" : null,
      allocation: null,
    }));
    return { mode: null, rows, count: rows.length, more: 0 };
  }
  const members = membersOf(entry);
  const mode = modeOf(members);
  const leads = leadsOf(entry);
  const shared = sharedOf(entry);
  const named =
    mode === "selected"
      ? members
      : uniqueAddresses([...leads, ...Object.keys(shared?.allocations ?? {})]);
  // The configuration may still name someone an admin removed from the workspace.
  const present = uniqueAddresses(named).filter(
    (email) => people.length === 0 || people.some((person) => sameAddress(person.email, email)),
  );
  const rows = [
    ...present.filter((email) => includesAddress(leads, email)),
    ...present.filter((email) => !includesAddress(leads, email)),
  ].map((email) => ({
    email,
    name: personName(people, { email }),
    you: isMe(email),
    lead: includesAddress(leads, email),
    allocation: allocationOfRow(shared, email, currency),
  }));
  const count = mode === "all" ? Math.max(people.length, rows.length) : rows.length;
  return { mode, rows, count, more: count - rows.length };
}

// ---- editing ------------------------------------------------------------------------------------

/**
 * The members to set when the person picks a mode. The whole workspace is `["*"]`. Named people
 * start from who the saved project named (or, if it had the whole workspace, from the person
 * editing), and always include the leads and everyone with a custom allocation, since the Hub
 * refuses a lead or an allocation for someone the project does not name.
 */
export function membersForMode(
  mode: WhoMode,
  input: {
    /** The project's entry as the draft has it. */
    readonly entry: unknown;
    /** The project's entry as saved. */
    readonly saved: unknown;
    readonly me: string | null;
  },
): string[] {
  if (mode === "all") return ["*"];
  const before = membersOf(input.saved);
  const start = before.includes("*") ? (input.me === null ? [] : [input.me]) : before;
  return uniqueAddresses([
    ...start,
    ...leadsOf(input.entry),
    ...Object.keys(sharedOf(input.entry)?.allocations ?? {}),
  ]);
}

export const addPeople = (
  members: ReadonlyArray<string>,
  emails: ReadonlyArray<string>,
): string[] => uniqueAddresses([...members.filter((member) => member !== "*"), ...emails]);

export const toggleLead = (leads: ReadonlyArray<string>, email: string): string[] =>
  includesAddress(leads, email) ? withoutAddress(leads, email) : [...leads, email];

export interface Removal {
  readonly members: string[];
  readonly leads: string[];
  /** The allocations without the person's, only when they had a custom one. */
  readonly allocations?: Record<string, number>;
}

/** What taking a person off the project sets: their place among the members, as lead and their allocation. */
export function removePerson(entry: unknown, email: string): Removal {
  const shared = sharedOf(entry);
  const custom =
    shared !== undefined && Object.keys(shared.allocations).some((key) => sameAddress(key, email));
  return {
    members: withoutAddress(membersOf(entry), email),
    leads: withoutAddress(leadsOf(entry), email),
    ...(custom && shared !== undefined
      ? {
          allocations: Object.fromEntries(
            Object.entries(shared.allocations).filter(([key]) => !sameAddress(key, email)),
          ),
        }
      : {}),
  };
}

/** The custom allocation a person has in the project, as text; null where they have none. */
export function customAllocation(entry: unknown, email: string, currency: string): string | null {
  const shared = sharedOf(entry);
  if (shared === undefined) return null;
  const key = Object.keys(shared.allocations).find((candidate) => sameAddress(candidate, email));
  const amount = key === undefined ? undefined : shared.allocations[key];
  return amount === undefined ? null : formatMoney(amount, currency);
}

/**
 * Who the add panel offers: the workspace's people not on the project yet, matching what was typed
 * in their name or address, by name.
 */
export function addCandidates(
  people: ReadonlyArray<WorkspacePerson>,
  taken: ReadonlyArray<string>,
  query: string,
): WorkspacePerson[] {
  const needle = query.trim().toLowerCase();
  return people
    .filter((person) => !includesAddress(taken, person.email))
    .filter(
      (person) =>
        needle === "" ||
        person.name.toLowerCase().includes(needle) ||
        person.email.toLowerCase().includes(needle),
    )
    .toSorted((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
}

// ---- words --------------------------------------------------------------------------------------

export function modeText(input: {
  readonly mode: WhoMode;
  readonly projectName: string;
  readonly workspaceName: string;
  /** How many people the workspace has; 0 while that is not known. */
  readonly workspaceSize: number;
}): string {
  const { projectName, workspaceName, workspaceSize } = input;
  if (input.mode === "selected") {
    return `Only the people below see ${projectName}’s tasks, threads and events, and can get requests and notifications for it.`;
  }
  const size =
    workspaceSize === 0 ? "" : ` (${workspaceSize} ${workspaceSize === 1 ? "person" : "people"})`;
  return `Everyone in ${workspaceName}${size} sees ${projectName}. New members of ${workspaceName} join it automatically.`;
}

export const moreText = (more: number, workspaceName: string): string =>
  `and ${more} more ${more === 1 ? "person" : "people"} in ${workspaceName}`;

/** What a member who cannot change who is on the project reads, with the people who can. */
export function readOnlyPeopleNote(projectName: string, leadNames: ReadonlyArray<string>): string {
  const lead = leadNames.length === 0 ? "" : ` Leads: ${leadNames.join(", ")}.`;
  return `Leads and admins change who’s on ${projectName}.${lead}`;
}

/** The names of the project's leads, as the document has them. */
export function leadNamesOf(
  entry: unknown,
  nameOf: (person: { readonly email: string }) => string,
): string[] {
  return leadsOf(entry).map((email) => nameOf({ email }));
}

/**
 * What saving does that the changes do not say: a project left without a lead, which only admins
 * then change, or a person giving up the lead they would need to change it again.
 */
export function peopleNotes(input: {
  readonly projectName: string;
  readonly workspaceName: string;
  /** The project's entry as saved, and as the draft has it. */
  readonly saved: unknown;
  readonly draft: unknown;
  readonly me: string | null;
  readonly admin: boolean;
}): string[] {
  const before = leadsOf(input.saved);
  const after = leadsOf(input.draft);
  if (before.length > 0 && after.length === 0) {
    return [
      `${input.projectName} will have no lead. Only admins of ${input.workspaceName} can change it then.`,
    ];
  }
  const { me } = input;
  if (!input.admin && me !== null && includesAddress(before, me) && !includesAddress(after, me)) {
    return [
      `You won’t be able to change ${input.projectName} after this: only its leads and admins can.`,
    ];
  }
  return [];
}

export interface RemovalWords {
  readonly title: string;
  readonly confirm: string;
  readonly consequences: ReadonlyArray<string>;
}

/** What taking a person off the project says before it does (design artboard 04). */
export function removalWords(input: {
  readonly projectName: string;
  readonly workspaceName: string;
  readonly person: { readonly name: string; readonly you: boolean };
  /** The project has shared capacity, so the person has a key for it. */
  readonly sharedCapacity: boolean;
  /** Their custom allocation, as text, when they have one. */
  readonly allocation: string | null;
}): RemovalWords {
  const { projectName, workspaceName, person } = input;
  const their = person.you ? "Your" : "Their";
  return {
    title: person.you
      ? `Remove yourself from ${projectName}?`
      : `Remove ${person.name} from ${projectName}?`,
    confirm: person.you ? "Remove yourself" : `Remove ${person.name}`,
    consequences: [
      person.you
        ? `You stop seeing ${projectName}’s tasks, threads and events, and stop getting its notifications.`
        : `Stops seeing ${projectName}’s tasks, threads and events, and stops getting its notifications.`,
      ...(input.sharedCapacity
        ? [`${their} key for ${projectName}’s shared capacity is revoked.`]
        : []),
      ...(input.allocation === null
        ? []
        : [`${their} allocation of ${input.allocation} is dropped.`]),
      person.you
        ? `You stay in ${workspaceName} and in other projects.`
        : `${person.name} stays in ${workspaceName} and in other projects.`,
    ],
  };
}
