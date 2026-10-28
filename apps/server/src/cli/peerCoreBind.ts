/**
 * `peer core bind [folder] --project <workspace/project> [--repository <id>]`: a clone on this
 * computer becomes the checkout of a project's repository, as binding by remote does on its own
 * when only one project's repository is the clone's `origin`.
 *
 * @module cli/peerCoreBind
 */
import * as Effect from "effect/Effect";

import { run } from "../peerHub/core/local.ts";
import * as PeerState from "../peerHub/core/state/PeerState.ts";
import { checkoutKind } from "../peerHub/core/vcs.ts";
import { fail, type OneShotIo } from "./peerCoreIo.ts";
import { matchRepositories } from "./remotes.ts";

export interface BindInput {
  readonly folder: string;
  /** `workspace/project`. */
  readonly project: string;
  readonly repository?: string;
}

/** The working tree around `folder`: Git's top level, or the Jujutsu workspace's root. */
const repositoryRoot = (folder: string) =>
  Effect.promise(async () => {
    const toplevel = await run("git", ["-C", folder, "rev-parse", "--show-toplevel"]).catch(
      () => null,
    );
    if (toplevel !== null && toplevel !== "")
      return { root: PeerState.realpathOrSelf(toplevel), remoteRoot: toplevel };
    const found = await checkoutKind(folder);
    return found?.kind === "jj"
      ? { root: PeerState.realpathOrSelf(found.root), remoteRoot: found.mainRoot }
      : null;
  });

export const bind = (input: BindInput, io: OneShotIo) =>
  Effect.gen(function* () {
    const state = yield* PeerState.PeerState;
    const [workspace, projectId, ...rest] = input.project.trim().split("/");
    if (workspace === undefined || projectId === undefined || rest.length > 0 || projectId === "")
      return yield* fail(
        `peer core: --project takes <workspace>/<project>, as peer core status names it; not ${input.project}.`,
      );
    const { project } = yield* state
      .project(workspace, projectId)
      .pipe(Effect.mapError((error) => fail(`peer core: ${error.detail}`)));
    const checkout = yield* repositoryRoot(input.folder);
    if (checkout === null)
      return yield* fail(`peer core: ${input.folder} is not a Git or Jujutsu repository.`);
    let repositoryId = input.repository?.trim();
    if (repositoryId !== undefined) {
      if (!project.repositories.some((repository) => repository.id === repositoryId))
        return yield* fail(
          `peer core: ${workspace}/${projectId} has no repository ${repositoryId}: ${project.repositories.map((r) => r.id).join(", ")}.`,
        );
    } else {
      const remote = yield* Effect.promise(() => PeerState.remoteOf(checkout.remoteRoot));
      const matches =
        remote === null
          ? []
          : matchRepositories(remote, [{ workspace: { slug: workspace }, projects: [project] }]);
      if (matches.length !== 1)
        return yield* fail(
          `peer core: ${remote === null ? `${checkout.root} has no origin` : `${checkout.root}'s origin ${remote} is ${matches.length === 0 ? "none" : "several"} of ${workspace}/${projectId}'s repositories`} (${project.repositories.map((r) => `${r.id} ${r.url}`).join(", ")}); name one with --repository <id>.`,
        );
      repositoryId = matches[0]!.repository;
    }
    yield* state
      .recordCheckout({ workspace, projectId, repositoryId }, checkout.root)
      .pipe(Effect.mapError((error) => fail(`peer core: ${error.detail}`)));
    yield* io.say(
      `Bound ${checkout.root} to ${workspace}/${projectId}${project.repositories.length > 1 ? ` (repository ${repositoryId})` : ""}.`,
    );
  });
