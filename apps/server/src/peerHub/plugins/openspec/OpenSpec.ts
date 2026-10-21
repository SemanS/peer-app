import {
  PeerHubError,
  type PeerOpenSpecReadInput,
  type PeerOpenSpecReadResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { checkoutState } from "../../core/vcs.ts";
import { PeerHubClient } from "../../core/hub/PeerHubClient.ts";
import { PeerState, safeId } from "../../core/state/PeerState.ts";
import { PeerWork } from "../../core/work/PeerWork.ts";
import { readTaskSource } from "./read.ts";

const isHubError = Schema.is(PeerHubError);

export class OpenSpec extends Context.Service<
  OpenSpec,
  {
    readonly read: (
      input: PeerOpenSpecReadInput,
    ) => Effect.Effect<PeerOpenSpecReadResult, PeerHubError>;
  }
>()("t3/peerHub/plugins/openspec/OpenSpec") {}

const make = Effect.gen(function* () {
  const state = yield* PeerState;
  const hub = yield* PeerHubClient;
  const work = yield* PeerWork;
  return OpenSpec.of({
    read: Effect.fn("OpenSpec.read")(function* (input) {
      yield* hub.session;
      const { workspace, project } = yield* state.project(input.workspace, input.projectId);
      const task = (yield* work.tasks(workspace.slug, project.id)).find(
        (one) => one.id === input.taskId,
      );
      if (task === undefined)
        return yield* new PeerHubError({ detail: "That task does not belong to this project." });
      const repositories =
        input.repositoryId === undefined
          ? project.repositories
          : project.repositories.filter((one) => one.id === input.repositoryId);
      if (input.repositoryId !== undefined && repositories.length === 0)
        return yield* new PeerHubError({
          detail: "That repository does not belong to this project.",
        });
      if (repositories.length !== 1)
        return {
          state: "unavailable",
          code: "source-unavailable",
          reason:
            repositories.length === 0
              ? "This project has no repository."
              : "Choose a repository to read this task's OpenSpec change.",
        };
      const repository = repositories[0]!;
      if (!safeId(repository.id))
        return yield* new PeerHubError({ detail: "The repository has an unsafe identifier." });
      const runtime = yield* state.read;
      const checkout = state.checkoutPath(
        runtime.persisted,
        workspace.slug,
        project.id,
        repository.id,
      );
      if (runtime.checkouts.has(checkout))
        return {
          state: "unavailable",
          code: "source-unavailable",
          reason: "The project repository is not ready on this environment.",
        };
      const checkoutStatus = yield* Effect.tryPromise({
        try: () => checkoutState(checkout),
        catch: () => new PeerHubError({ detail: "Could not inspect the project repository." }),
      });
      if (checkoutStatus.state !== "ready")
        return {
          state: "unavailable",
          code: "source-unavailable",
          reason: "The project repository is not ready on this environment.",
        };
      return yield* Effect.tryPromise({
        try: () => readTaskSource(checkout, repository.id, task),
        catch: (error) =>
          isHubError(error)
            ? error
            : new PeerHubError({
                detail: "Could not read the OpenSpec source on this environment.",
              }),
      });
    }),
  });
});
export const layer = Layer.effect(OpenSpec, make);
