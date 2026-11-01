// @effect-diagnostics nodeBuiltinImport:off - clones into the person's own checkouts.
/**
 * Checkouts of workspace repositories on this computer: cloning one, and reading what sharing a
 * repository gives the workspace.
 *
 * @module peerHub/core/workspaces/checkouts
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { PeerHubError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { isSafeGitRemote } from "../../gitSafety.ts";
import { idFromName } from "../../names.ts";
import { gitHubRepository } from "../../workLifecycle.ts";
import { run, runOutput } from "../local.ts";
import { gitWay } from "./gitHost.ts";

/** How long a clone or a pull may take: a big repository over a slow connection takes a while. */
const GIT_TIMEOUT_MS = 15 * 60 * 1000;

const hubError = (detail: string) => new PeerHubError({ detail });

/** Clones `repo` into `path`; it fails with why, in words a person can act on. */
export const cloneRepository = (
  repo: { readonly url: string; readonly branch: string },
  path: string,
) =>
  Effect.gen(function* () {
    const way = yield* gitWay(repo.url);
    yield* Effect.tryPromise({
      try: async () => {
        await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
        await run(
          "git",
          [...way.args, "clone", "--quiet", "--branch", repo.branch, "--", way.url, path],
          { timeoutMs: GIT_TIMEOUT_MS },
        );
      },
      catch: (failure) => way.explain(runOutput(failure), repo),
    });
    yield* way.configure(path);
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
          `${title} is only on this computer, so your team cannot clone it. Publish it first, then share it.`,
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
 * A repository by its address, as "Add project" takes one: GitHub's `owner/repo` or a clone URL.
 * Asking it for its default branch also shows that the person sharing it can open it.
 */
export const addressedRepository = (address: string) =>
  Effect.gen(function* () {
    const named = gitHubRepository(address);
    if (named === null && !isSafeGitRemote(address)) {
      return yield* hubError(
        `"${address}" is not a repository address. Enter GitHub's owner/repo or a clone URL.`,
      );
    }
    const url = named?.httpsUrl ?? address;
    const way = yield* gitWay(url);
    const head = yield* Effect.tryPromise({
      try: () =>
        run("git", [...way.args, "ls-remote", "--symref", way.url, "HEAD"], { timeoutMs: 60_000 }),
      catch: (failure) => hubError(way.explain(runOutput(failure), { url, branch: "" })),
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
