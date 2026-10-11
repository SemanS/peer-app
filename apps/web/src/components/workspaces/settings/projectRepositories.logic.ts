/**
 * A project's repositories as the Repositories page edits them: the keyed list (by `id`) in the
 * settings document, what is wrong with an address, a branch or an id, the id a new repository gets
 * from its address, and what each row says of PRs and of the clone on this computer. Which addresses
 * and branches are safe for a computer to clone is `shared.logic`'s; the id rule is the Hub's
 * (`valid_id`).
 */
import type { PeerCheckoutState, PeerHubStatus } from "@t3tools/contracts";

import { isSafeGitRef, isSafeGitRemote } from "./shared.logic";

/** A project has up to this many repositories (the limit sharing a project from Peer has too). */
export const MAX_REPOSITORIES = 10;

export interface RepositoryEntry {
  readonly id: string;
  readonly url: string;
  readonly branch: string;
}

const isMapping = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The repositories a document's list holds: the elements that have an id, an address and a branch. */
export function repositoriesOf(value: unknown): ReadonlyArray<RepositoryEntry> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((element: unknown) =>
    isMapping(element) &&
    typeof element.id === "string" &&
    typeof element.url === "string" &&
    typeof element.branch === "string"
      ? [{ id: element.id, url: element.url, branch: element.branch }]
      : [],
  );
}

/** A repository id the Hub takes: lowercase kebab-case, 1 to 48 characters. */
export const isRepositoryId = (id: string): boolean =>
  id.length <= 48 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);

/**
 * Whether the address carries a password or token: any user in an http(s) address, a password in
 * another scheme's. Settings are shared, so a secret does not belong in one.
 */
export function hasCredentials(url: string): boolean {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(url);
  const scheme = match?.[1];
  const authority = match?.[2];
  if (scheme === undefined || authority === undefined) return false;
  const at = authority.lastIndexOf("@");
  if (at < 0) return false;
  return /^https?$/i.test(scheme) || authority.slice(0, at).includes(":");
}

/** The host an address names, lowercase: of `https://…`, `ssh://git@…`, `git@host:path` or `host/path`. */
export function hostOf(url: string): string | null {
  const address = url.trim();
  const named =
    /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/?#:]+)/i.exec(address) ??
    /^(?:[A-Za-z0-9._-]+@)?([A-Za-z0-9.-]+):[^:/\\]/.exec(address) ??
    /^([A-Za-z0-9.-]+)\//.exec(address);
  return named?.[1]?.toLowerCase() ?? null;
}

/** Whether Peer can confirm a pull request's merge on this host (GitHub's signed webhooks). */
export const isGitHubUrl = (url: string): boolean => hostOf(url) === "github.com";

/** An address as the list shows it: without `https://` and a trailing `.git`. */
export const shortUrl = (url: string): string =>
  url
    .trim()
    .replace(/^https:\/\//i, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");

/** The id a repository gets from its address: its name in kebab-case, `repository` where it has none. */
export function repositoryIdFromUrl(url: string): string {
  const path = url.trim().replace(/[?#].*$/, "");
  const name = (path.split(/[/:]/).findLast((part) => part !== "") ?? "").replace(/\.git$/i, "");
  const kebab = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36)
    .replace(/-+$/g, "");
  return kebab === "" ? "repository" : kebab;
}

/** `id`, or `id-2`, `id-3` … the first the project does not have. */
export function uniqueRepositoryId(id: string, taken: ReadonlyArray<string>): string {
  if (!taken.includes(id)) return id;
  for (let n = 2; n <= taken.length + 1; n += 1) {
    const candidate = `${id}-${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${id}-${taken.length + 2}`;
}

export const URL_PROBLEM = "Use a full address: https://…, ssh://…, git://…, or user@host:path.";
export const CREDENTIALS_PROBLEM = "Leave passwords and tokens out of the address.";
export const BRANCH_PROBLEM = "Use a branch name, like main or release/2026.";

/** What is wrong with a branch name; null where it is fine. */
export function branchProblem(branch: string): string | null {
  const name = branch.trim();
  if (name === "") return "Give the branch a name.";
  return isSafeGitRef(name) ? null : BRANCH_PROBLEM;
}

/**
 * What is wrong with what the form holds, so far: nothing is said of an address not typed yet.
 * `ready` is whether the repository can be added.
 */
export function newRepositoryProblems(input: { readonly url: string; readonly branch: string }): {
  readonly url: string | null;
  readonly branch: string | null;
  readonly ready: boolean;
} {
  const url = input.url.trim();
  const urlProblem =
    url === ""
      ? null
      : hasCredentials(url)
        ? CREDENTIALS_PROBLEM
        : isSafeGitRemote(url)
          ? null
          : URL_PROBLEM;
  const branch = branchProblem(input.branch);
  return { url: urlProblem, branch, ready: url !== "" && urlProblem === null && branch === null };
}

const hasId = (element: unknown, id: string) => isMapping(element) && element.id === id;

const listOf = (list: unknown): ReadonlyArray<unknown> => (Array.isArray(list) ? list : []);

/** The list with a repository at its end; the Hub writes new ones last. */
export const addRepository = (list: unknown, entry: RepositoryEntry): ReadonlyArray<unknown> => [
  ...listOf(list),
  { id: entry.id, url: entry.url.trim(), branch: entry.branch.trim() },
];

export const removeRepository = (list: unknown, id: string): ReadonlyArray<unknown> =>
  listOf(list).filter((element) => !hasId(element, id));

/** The list with one repository on another branch; whatever else its element holds is kept. */
export const setRepositoryBranch = (
  list: unknown,
  id: string,
  branch: string,
): ReadonlyArray<unknown> =>
  listOf(list).map((element) =>
    hasId(element, id) && isMapping(element) ? { ...element, branch: branch.trim() } : element,
  );

/** Whether the workspace verifies pull requests with GitHub's signed webhooks, as the task views read it. */
export const githubChecksOn = (status: Pick<PeerHubStatus, "github">, workspace: string): boolean =>
  status.github.verification?.find((entry) => entry.workspace === workspace)?.configured === true;

/** "PRs verified" where Peer can confirm a merge (GitHub checks on, a github.com address), else as the agent reports. */
export const prVerification = (url: string, checksOn: boolean): "verified" | "reported" =>
  checksOn && isGitHubUrl(url) ? "verified" : "reported";

export const PR_LABEL: Readonly<Record<"verified" | "reported", string>> = {
  verified: "PRs verified",
  reported: "PRs as reported",
};

/** What a row says of the clone on this computer. */
export type CloneView =
  | { readonly kind: "cloned" }
  /** Cloned, and not yet open as a project here. */
  | { readonly kind: "open" }
  | { readonly kind: "cloning" }
  | { readonly kind: "clone"; readonly error: string | undefined }
  /** Not in the manifest yet, so there is nothing to clone. */
  | { readonly kind: "unsaved" };

export function cloneView(
  repository:
    | {
        readonly state: PeerCheckoutState;
        readonly projectId?: unknown;
        readonly error?: string | undefined;
      }
    | undefined,
): CloneView {
  if (repository === undefined) return { kind: "unsaved" };
  switch (repository.state) {
    case "ready":
      return repository.projectId === undefined ? { kind: "open" } : { kind: "cloned" };
    case "cloning":
      return { kind: "cloning" };
    case "missing":
    case "error":
      return { kind: "clone", error: repository.error };
  }
}
