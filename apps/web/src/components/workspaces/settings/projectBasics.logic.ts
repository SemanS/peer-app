/**
 * What a project's Basics tab shows and does, apart from how it draws (design artboard 05): the
 * values of its form read from the settings document, what the knowledge switches say, what typed
 * text becomes in the document, and what deleting the project says it takes with it.
 */
import { getAt } from "@t3tools/client-runtime/peer-settings";

import type { ReviewOperation } from "./reviewChanges.logic";
import type { SettingsDocument } from "./settingsView.logic";

/** The longest description the form takes. */
export const DESCRIPTION_MAX = 300;

type Mapping = Readonly<Record<string, unknown>>;

const isMapping = (value: unknown): value is Mapping =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const textAt = (entry: unknown, path: ReadonlyArray<string>): string | undefined => {
  const value = getAt(entry, path);
  return typeof value === "string" ? value : undefined;
};

const flagAt = (entry: unknown, path: ReadonlyArray<string>): boolean | undefined => {
  const value = getAt(entry, path);
  return typeof value === "boolean" ? value : undefined;
};

// ---- the form ------------------------------------------------------------------------------------

/** What the Basics form edits. */
export interface BasicsValues {
  readonly name: string;
  readonly client: string;
  readonly description: string;
  readonly kontext: boolean;
  readonly company: boolean;
}

/**
 * The form's values from the project's entry of the settings document; where the document is not
 * read (an older Hub, or a moment before it arrives) from what the manifest says of the project.
 * Knowledge is on unless the entry turns it off, as the Hub reads a project.
 */
export function basicsValues(
  entry: unknown,
  manifest: {
    readonly name: string;
    readonly client?: string | undefined;
    readonly description?: string | undefined;
    readonly knowledge: { readonly kontext: boolean; readonly company: boolean };
  },
): BasicsValues {
  if (!isMapping(entry)) {
    return {
      name: manifest.name,
      client: manifest.client ?? "",
      description: manifest.description ?? "",
      kontext: manifest.knowledge.kontext,
      company: manifest.knowledge.company,
    };
  }
  return {
    name: textAt(entry, ["name"]) ?? manifest.name,
    client: textAt(entry, ["client"]) ?? "",
    description: textAt(entry, ["description"]) ?? "",
    kontext: flagAt(entry, ["knowledge", "kontext"]) ?? true,
    company: flagAt(entry, ["knowledge", "company"]) ?? true,
  };
}

/**
 * What typed text becomes in the document: trimmed, and nothing for a blank. A name that comes to
 * nothing is not taken into the draft (a project needs one); a blank client or description removes
 * the field.
 */
export function settledText(text: string): string | undefined {
  const trimmed = text.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** How long a text is, in characters as people count them. */
export const textLength = (text: string): number => Array.from(text).length;

/** "92 / 300": beside the description's label. */
export const descriptionCount = (text: string): string =>
  `${textLength(text)} / ${DESCRIPTION_MAX}`;

export const NAME_REQUIRED = "A project needs a name.";

// ---- knowledge ------------------------------------------------------------------------------------

/** The id of the first repository the project's entry lists, which holds its `.ai/` store. */
export function firstRepositoryId(entry: unknown): string | undefined {
  const repositories = getAt(entry, ["repositories"]);
  if (!Array.isArray(repositories)) return undefined;
  const first: unknown = repositories[0];
  return isMapping(first) && typeof first.id === "string" && first.id !== "" ? first.id : undefined;
}

export function projectKnowledgeHint(repositoryId: string | undefined): string {
  return repositoryId === undefined
    ? "Decisions and conventions in .ai/ of its repository. Add a repository first."
    : `Decisions and conventions in .ai/ of ${repositoryId}`;
}

/** Where the workspace keeps its shared knowledge. */
export interface CompanyStore {
  readonly repository: string;
  /** Undefined where only the manifest says (it does not name the branch). */
  readonly branch: string | undefined;
}

/**
 * The workspace's company knowledge store: what the settings document's `knowledge.company` says
 * (the Hub names its branch, `main` unless set), else, while the document is not read, the
 * repository the manifest lists. Null where the workspace has none.
 */
export function companyStoreOf(
  document: SettingsDocument | null,
  manifest: { readonly repository: string } | null,
): CompanyStore | null {
  if (document === null) {
    return manifest === null ? null : { repository: manifest.repository, branch: undefined };
  }
  const company = getAt(document, ["knowledge", "company"]);
  if (!isMapping(company) || typeof company.repository !== "string" || company.repository === "") {
    return null;
  }
  return {
    repository: company.repository,
    branch: typeof company.branch === "string" && company.branch !== "" ? company.branch : "main",
  };
}

/**
 * A repository address as `owner/repo`, the way people name one: the path of a web or ssh address,
 * or of the scp form `git@host:owner/repo.git`, without `.git`. Anything else stays as written.
 */
export function shortRepository(address: string): string {
  const url = address.trim();
  const path =
    /^[a-z][a-z0-9+.-]*:\/\/[^/]+\/(.+)$/i.exec(url)?.[1] ??
    /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+:([^/\\:][^:]*)$/.exec(url)?.[1];
  if (path === undefined) return url;
  const short = path.replace(/\/+$/, "").replace(/\.git$/i, "");
  return short === "" ? url : short;
}

export function companyKnowledgeHint(workspaceName: string, store: CompanyStore | null): string {
  if (store === null) {
    return `${workspaceName} has no shared knowledge store yet. Its admins add one in Workspace › General.`;
  }
  const where = shortRepository(store.repository);
  return `${workspaceName}’s shared store · ${where}${store.branch === undefined ? "" : ` on ${store.branch}`}`;
}

// ---- reading it as a member ---------------------------------------------------------------------

const capital = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/**
 * What the form says to someone who may not change it: who may, in the Hub's words ("Booking's
 * leads and admins"), and the leads by name.
 */
export function basicsReadOnlyNote(owners: string, leadNames: ReadonlyArray<string>): string {
  const leads = leadNames.length === 0 ? "" : ` Leads: ${leadNames.join(", ")}.`;
  return `${capital(owners)} change this.${leads}`;
}

// ---- deleting -------------------------------------------------------------------------------------

export interface DeleteFacts {
  readonly tasks: number;
  /** The project's areas, in which tasks sit. */
  readonly areas: number;
  /** The people the project goes away for. */
  readonly people: number;
  /** The project has shared capacity, so a gateway team exists under its id. */
  readonly gatewayTeam: boolean;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What goes away with the project, and what does not, one line each (design artboard 05): its
 * tasks with their context and coordination history, its settings, its place in Work for the
 * people on it, and what stays behind (their threads, the gateway team with its usage).
 */
export function deleteConsequences(
  project: { readonly id: string; readonly name: string },
  facts: DeleteFacts,
): string[] {
  const tasks =
    facts.tasks === 0
      ? `${facts.areas > 0 ? "Its areas, task" : "Its task"} context and coordination history`
      : `${count(facts.tasks, "task", "tasks")}${
          facts.areas > 0 ? ` in ${count(facts.areas, "area", "areas")}` : ""
        }, with their task context and coordination history`;
  return [
    tasks,
    `${project.name}’s settings: people, tools, path rules and allocations`,
    `${project.name} leaves Work for ${count(facts.people, "person", "people")}. Threads on their computers stay, without the project.`,
    ...(facts.gatewayTeam
      ? [`The gateway team “${project.id}” stays, with its usage. Remove it there if you want.`]
      : []),
  ];
}

/** The person typed the project's id, so the delete button is on. */
export const confirmsDeletion = (typed: string, id: string): boolean => typed.trim() === id;

/** The change that deletes a project: its node set to nothing, against the revision the page read. */
export function deleteOperation(workspace: string, base: number, id: string): ReviewOperation {
  return { kind: "save", workspace, base, set: [{ path: ["projects", id], value: null }] };
}
