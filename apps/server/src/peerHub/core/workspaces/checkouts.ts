// @effect-diagnostics nodeBuiltinImport:off - clones into the person's own checkouts.
/**
 * Checkouts of workspace repositories on this computer: cloning one, through the git host that
 * owns its address or with git's own sign-in (SSH keys, the keychain); keeping a workspace's
 * company knowledge current; and reading what sharing a repository gives the workspace.
 *
 * @module peerHub/core/workspaces/checkouts
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { PeerHubError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { explainCloneFailure } from "../../cloneFailure.ts";
import { isSafeGitRemote } from "../../gitSafety.ts";
import { idFromName } from "../../names.ts";
import { run, runOutput } from "../local.ts";
import type { PeerGitHost } from "../plugin.ts";

/** How long a clone or a pull may take: a big repository over a slow connection takes a while. */
const GIT_TIMEOUT_MS = 15 * 60 * 1000;

const hubError = (detail: string) => new PeerHubError({ detail });

/** Why a clone failed, in words a person can act on; signing in to the host may fix it. */
export interface CloneFailure {
  readonly message: string;
  readonly signIn: boolean;
}

/** The git host that owns an address, if one does. */
const hostOf = (gitHost: PeerGitHost | undefined, url: string) =>
  gitHost !== undefined && gitHost.owns(url) ? gitHost : undefined;

/** Clones `repo` into `path`: through the git host that owns its address, or with plain git. */
export const cloneRepository = (
  repo: { readonly url: string; readonly branch: string },
  path: string,
  gitHost: PeerGitHost | undefined,
) =>
  Effect.gen(function* () {
    const host = hostOf(gitHost, repo.url);
    const via = host === undefined ? null : yield* host.clone(repo.url);
    yield* Effect.tryPromise({
      try: async () => {
        await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
        await run(
          "git",
          [
            ...(via?.args ?? []),
            "clone",
            "--quiet",
            "--branch",
            repo.branch,
            "--",
            via?.url ?? repo.url,
            path,
          ],
          { timeoutMs: GIT_TIMEOUT_MS },
        );
      },
      catch: (failure): CloneFailure =>
        host === undefined
          ? { message: explainCloneFailure(runOutput(failure), repo), signIn: false }
          : host.explain(runOutput(failure), repo),
    });
    if (via !== null) yield* via.configure(path);
  });

/**
 * A workspace's company knowledge cloned into `path`, or fast-forwarded where it `exists`; fails
 * with why not.
 */
export const pullKnowledge = (
  repository: { readonly repository: string; readonly branch: string },
  path: string,
  exists: boolean,
) =>
  Effect.tryPromise({
    try: async () => {
      if (exists) {
        await run("git", ["-C", path, "pull", "--ff-only", "--quiet"], {
          timeoutMs: GIT_TIMEOUT_MS,
        });
        return;
      }
      await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
      await run(
        "git",
        ["clone", "--quiet", "--branch", repository.branch, "--", repository.repository, path],
        { timeoutMs: GIT_TIMEOUT_MS },
      );
    },
    catch: (failure) =>
      explainCloneFailure(runOutput(failure), {
        url: repository.repository,
        branch: repository.branch,
      }),
  });

/** What sharing gives the workspace: one repository, and where it is checked out here if it is. */
export interface SharedRepository {
  readonly name: string;
  readonly repoId: string;
  readonly url: string;
  readonly branch: string;
  readonly root: string | null;
}

/** A project on this computer: its origin, and the branch that remote starts from. */
export const localRepository = (project: {
  readonly title: string;
  readonly workspaceRoot: string;
}) =>
  Effect.gen(function* () {
    const { title, workspaceRoot: root } = project;
    const url = yield* Effect.tryPromise(() =>
      run("git", ["-C", root, "remote", "get-url", "origin"]),
    ).pipe(
      Effect.mapError(() =>
        hubError(
          `${title} has no git remote named origin. Push it where your team can clone it, or share its repository by address.`,
        ),
      ),
    );
    if (!isSafeGitRemote(url)) {
      return yield* hubError(`${title}'s origin is not an address colleagues can clone.`);
    }
    // Colleagues start from the remote's own branch, not whatever is checked out here.
    const remoteHead = yield* Effect.tryPromise(() =>
      run("git", ["-C", root, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"]),
    ).pipe(Effect.orElseSucceed(() => ""));
    const local =
      remoteHead.replace(/^origin\//, "") ||
      (yield* Effect.tryPromise(() =>
        run("git", ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"]),
      ).pipe(Effect.orElseSucceed(() => "")));
    // A detached HEAD (always so under jj) names no branch: ask the remote for its default.
    const head =
      local !== "" && local !== "HEAD"
        ? local
        : (/^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(
            yield* Effect.tryPromise(() =>
              run("git", ["-C", root, "ls-remote", "--symref", "origin", "HEAD"], {
                timeoutMs: 15_000,
              }),
            ).pipe(Effect.orElseSucceed(() => "")),
          )?.[1] ?? "");
    return {
      name: title,
      repoId: idFromName(NodePath.basename(root), "repo"),
      url,
      branch: head === "" ? "main" : head,
      root,
    } satisfies SharedRepository;
  });

/**
 * A repository by its address, as "Add project" takes one: a git host's own form (GitHub's
 * `owner/repo`) or a clone URL. Asking it for its default branch also shows that the person sharing
 * it can open it.
 */
export const addressedRepository = (address: string, gitHost: PeerGitHost | undefined) =>
  Effect.gen(function* () {
    const host = hostOf(gitHost, address);
    const named = host?.address(address) ?? null;
    if (named === null && !isSafeGitRemote(address)) {
      return yield* hubError(
        `"${address}" is not a repository address. Enter GitHub's owner/repo or a clone URL.`,
      );
    }
    const url = named?.url ?? address;
    const via = host === undefined ? null : yield* host.clone(url);
    const head = yield* Effect.tryPromise({
      try: () =>
        run("git", [...(via?.args ?? []), "ls-remote", "--symref", via?.url ?? url, "HEAD"], {
          timeoutMs: 60_000,
        }),
      catch: (failure) =>
        hubError(
          host === undefined
            ? explainCloneFailure(runOutput(failure), { url, branch: "" })
            : host.explain(runOutput(failure), { url, branch: "" }).message,
        ),
    });
    const name = named?.name ?? NodePath.basename(url.replace(/\/+$/, "")).replace(/\.git$/i, "");
    return {
      name,
      repoId: idFromName(name, "repo"),
      url,
      branch: /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(head)?.[1] ?? "main",
      root: null,
    } satisfies SharedRepository;
  });
