/**
 * What the New project form checks and sends, apart from how it draws (design artboard 06): the id a
 * name makes, what is wrong with the name or the repository, the project entry the form creates and
 * the change that adds it. The Hub's own check (`workspace::check`) decides again on every save;
 * these only keep the form from offering what it would refuse.
 */
import type { ReviewOperation } from "./reviewChanges.logic";
import { DESCRIPTION_MAX, settledText, textLength } from "./projectBasics.logic";
import type { WhoMode, WorkspacePerson } from "./projectPeople.logic";
import type { SettingsDocument } from "./settingsView.logic";
import { isSafeGitRef, isSafeGitRemote } from "./shared.logic";

/** The longest id the Hub takes. */
const PROJECT_ID_MAX = 48;

/** The scope of the workspace's own memory, which no project may take. */
const RESERVED_ID = "company";

/**
 * The id a name makes: lowercase letters and digits joined by single hyphens, at most 48
 * characters, accents set aside (`Café Ñandú` is `cafe-nandu`). A name with no letter or digit from
 * the Latin alphabet makes none.
 */
export function projectIdFromName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, PROJECT_ID_MAX)
    .replace(/-+$/g, "");
}

/** What the form shows of the id before there is a name to make one from. */
export const ID_PLACEHOLDER = "project-id";

/** The ids that exist already: the settings document's projects and the ones the manifest lists. */
export function takenProjectIds(
  document: SettingsDocument | null,
  manifestIds: ReadonlyArray<string>,
): ReadonlySet<string> {
  const projects = document?.projects;
  const named =
    typeof projects === "object" && projects !== null && !Array.isArray(projects)
      ? Object.keys(projects)
      : [];
  return new Set([...named, ...manifestIds]);
}

export interface NameProblem {
  readonly kind: "no-id" | "reserved" | "taken";
  readonly text: string;
}

/**
 * What is wrong with the name once something is typed: it makes no id, makes the reserved one, or
 * makes the id of a project that exists. Nothing is said of an empty name, which only keeps Create
 * off.
 */
export function nameProblem(input: {
  readonly name: string;
  readonly id: string;
  readonly taken: ReadonlySet<string>;
}): NameProblem | null {
  const { id } = input;
  if (input.name.trim() === "") return null;
  if (id === "") {
    return {
      kind: "no-id",
      text: "The ID is made from the letters a–z and the digits in the name. Add some.",
    };
  }
  if (id === RESERVED_ID) {
    return { kind: "reserved", text: `“${RESERVED_ID}” is reserved. Pick another name.` };
  }
  if (input.taken.has(id)) {
    return {
      kind: "taken",
      text: `A project with the ID “${id}” exists already. Pick another name.`,
    };
  }
  return null;
}

// ---- the repository -------------------------------------------------------------------------------

/**
 * The id a repository gets from its address: the last part of its path without `.git`, as an id
 * (`https://github.com/acme/Booking-API.git` is `booking-api`); `repo` when that makes none.
 */
export function repositoryIdFromUrl(url: string): string {
  const path = url.trim().replace(/[?#].*$/, "");
  const last = path.split(/[/:\\]/).findLast((part) => part !== "") ?? "";
  const id = projectIdFromName(last.replace(/\.git$/i, ""));
  return id === "" ? "repo" : id;
}

const DEFAULT_BRANCH = "main";

export interface RepositoryInput {
  readonly url: string;
  readonly branch: string;
}

export interface RepositoryProblem {
  readonly field: "url" | "branch";
  readonly text: string;
}

/**
 * What is wrong with the repository the person typed. It is optional: with no address there is
 * none, and the branch is `main` while it is empty.
 */
export function repositoryProblem(input: RepositoryInput): RepositoryProblem | null {
  const url = input.url.trim();
  if (url === "") return null;
  if (!isSafeGitRemote(url)) {
    return {
      field: "url",
      text: "Enter a clone address, like https://github.com/acme/booking-api.",
    };
  }
  const branch = input.branch.trim();
  if (branch !== "" && !isSafeGitRef(branch)) {
    return {
      field: "branch",
      text: "A branch has letters, digits and . _ / - only, and does not start with - or /.",
    };
  }
  return null;
}

/** The repository entry the form adds; null with no address. */
export function repositoryEntry(
  input: RepositoryInput,
): { readonly id: string; readonly url: string; readonly branch: string } | null {
  const url = input.url.trim();
  if (url === "") return null;
  return {
    id: repositoryIdFromUrl(url),
    url,
    branch: input.branch.trim() === "" ? DEFAULT_BRANCH : input.branch.trim(),
  };
}

/** A project open on this computer that has a repository the Hub would take; `id` is the project's here. */
export interface RepositoryChoice<Id extends string = string> {
  readonly id: Id;
  readonly title: string;
  readonly url: string;
}

/**
 * The projects open on this computer whose checkout has a remote the Hub would take, to pick a
 * repository from: its origin is the address, and the project's title what the person knows it by.
 */
export function repositoryChoices<Id extends string>(
  projects: ReadonlyArray<{
    readonly id: Id;
    readonly title: string;
    readonly repositoryIdentity?:
      | { readonly locator: { readonly remoteUrl: string } }
      | null
      | undefined;
  }>,
): RepositoryChoice<Id>[] {
  return projects.flatMap((project) => {
    const url = project.repositoryIdentity?.locator.remoteUrl;
    return url !== undefined && isSafeGitRemote(url)
      ? [{ id: project.id, title: project.title, url }]
      : [];
  });
}

/**
 * What binds the checkout the person picked to the project the form created, so this computer
 * works in it instead of cloning the repository again: the repository the form's address makes an
 * id for, and the project open here. Null when none was picked, or when the address was changed
 * after picking: the person then means that repository, not the checkout they first chose.
 */
export function checkoutBinding<Id extends string>(input: {
  readonly workspace: string;
  /** The id of the project the form created. */
  readonly id: string;
  readonly repository: RepositoryInput;
  readonly picked: RepositoryChoice<Id> | null;
}): {
  readonly workspace: string;
  readonly projectId: string;
  readonly repositoryId: string;
  readonly localProjectId: Id;
} | null {
  const entry = repositoryEntry(input.repository);
  if (entry === null || input.picked === null || entry.url !== input.picked.url) return null;
  return {
    workspace: input.workspace,
    projectId: input.id,
    repositoryId: entry.id,
    localProjectId: input.picked.id,
  };
}

// ---- who is on it ---------------------------------------------------------------------------------

export interface Chip {
  readonly email: string;
  readonly name: string;
  /** The creator, who leads and cannot be taken off. */
  readonly lead: boolean;
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * The people chosen, the creator first (a lead, always). Addresses the workspace lists take its
 * name for them; the creator's address is never listed twice.
 */
export function chipsFor(
  me: string,
  chosen: ReadonlyArray<string>,
  people: ReadonlyArray<WorkspacePerson>,
  nameOf: (person: { readonly email: string }) => string,
): Chip[] {
  const others = chosen.filter(
    (email, index) =>
      !sameAddress(email, me) &&
      chosen.findIndex((candidate) => sameAddress(candidate, email)) === index &&
      people.some((person) => sameAddress(person.email, email)),
  );
  return [
    { email: me, name: nameOf({ email: me }), lead: true },
    ...others.map((email) => ({ email, name: nameOf({ email }), lead: false })),
  ];
}

// ---- creating -------------------------------------------------------------------------------------

export interface NewProjectInput {
  readonly name: string;
  readonly client: string;
  readonly description: string;
  readonly who: WhoMode;
  /** The people chosen besides the creator. */
  readonly people: ReadonlyArray<string>;
  readonly repository: RepositoryInput;
  /** The creator, who becomes its lead. */
  readonly me: string;
}

/**
 * The project the form creates: its name, the client and description when given, the whole
 * workspace or the creator and the people chosen, the creator as its only lead and the repository
 * when there is one. Everything else (areas, tools, capacity, coordination) the Hub defaults.
 */
export function newProjectValue(input: NewProjectInput): Record<string, unknown> {
  const client = settledText(input.client);
  const description = settledText(input.description);
  const repository = repositoryEntry(input.repository);
  const members =
    input.who === "all"
      ? ["*"]
      : [
          input.me,
          ...input.people.filter(
            (email, index) =>
              !sameAddress(email, input.me) &&
              input.people.findIndex((candidate) => sameAddress(candidate, email)) === index,
          ),
        ];
  return {
    name: input.name.trim(),
    ...(client === undefined ? {} : { client }),
    ...(description === undefined ? {} : { description }),
    members,
    leads: [input.me],
    repositories: repository === null ? [] : [repository],
  };
}

/** The change that creates the project: its node set, against the revision the page read. */
export function createOperation(input: {
  readonly workspace: string;
  readonly base: number;
  readonly id: string;
  readonly project: NewProjectInput;
}): ReviewOperation {
  return {
    kind: "save",
    workspace: input.workspace,
    base: input.base,
    set: [{ path: ["projects", input.id], value: newProjectValue(input.project) }],
  };
}

/** Whether Create is on: a name that makes a free id, a description that fits, a repository that clones. */
export function readyToCreate(input: {
  readonly name: string;
  readonly nameProblem: NameProblem | null;
  readonly description: string;
  readonly repositoryProblem: RepositoryProblem | null;
  /** The settings were read, so the change has a revision to start from. */
  readonly read: boolean;
}): boolean {
  return (
    input.read &&
    input.name.trim() !== "" &&
    input.nameProblem === null &&
    textLength(input.description) <= DESCRIPTION_MAX &&
    input.repositoryProblem === null
  );
}
