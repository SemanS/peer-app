import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  PeerHubAssignThreadInput,
  PeerHubTaskInput,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";

/** Place the final thread on its launch host before the first turn can publish work. */
export async function startThreadWithWorkTask<A, E, PlacementError>(options: {
  readonly workTask: PeerHubTaskInput | null | undefined;
  readonly threadRef: ScopedThreadRef;
  readonly assign: (request: {
    environmentId: EnvironmentId;
    input: PeerHubAssignThreadInput;
  }) => Promise<AtomCommandResult<unknown, PlacementError>>;
  readonly start: () => Promise<AtomCommandResult<A, E>>;
}): Promise<AtomCommandResult<A, E | PlacementError>> {
  if (options.workTask) {
    const placement = await options.assign({
      environmentId: options.threadRef.environmentId,
      input: { ...options.workTask, thread: `peer:${options.threadRef.threadId}` },
    });
    if (placement._tag === "Failure") return AsyncResult.failure(placement.cause);
  }
  return options.start();
}
