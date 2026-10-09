/**
 * Peer Memory's MCP tools as a service: each call is bound to the live runtime that makes it (its
 * thread, provider session and instance), refused while memory is turned off, and kept to that
 * runtime's project, or its company scope for reads.
 *
 * It imports nothing of core's plugins: the tools' module loads it, and core's registry loads the
 * plugin that loads the tools.
 *
 * @module peerHub/plugins/memory/mcp/PeerMemoryMcpService
 */
import {
  OrchestratorMcpFailure,
  type PeerHubError,
  type PeerHubMemoryExecuteInput,
  type PeerHubMemorySearchInput,
  type PeerHubMemoryReadInput,
  type PeerHubMemoryProjectInput,
  type PeerHubMemoryChangesInput,
  type PeerMemoryReceiptInput,
  type PeerMemoryScope,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { readMutationCaller } from "../../../../mcp/threadAccess.ts";
import * as ThreadManagement from "../../../../orchestration-v2/ThreadManagementService.ts";
import * as MemoryRuntime from "../MemoryRuntime.ts";
import * as MemoryService from "../MemoryService.ts";

const failure = (error: { readonly detail: string }) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message: error.detail });
type RuntimeScope = {
  readonly workspace?: string | undefined;
  readonly project?: string | undefined;
};
type RuntimeScoped<A extends PeerMemoryScope> = Omit<A, keyof PeerMemoryScope> & RuntimeScope;
const scoped = <A extends RuntimeScope>(input: A, session: PeerMemoryScope) => ({
  ...input,
  workspace: input.workspace ?? session.workspace,
  project: input.project ?? session.project,
});
/** `active` fails, saying why, while memory is not active on this environment. */
const make = (active: Effect.Effect<void, PeerHubError>) =>
  Effect.gen(function* () {
    const runtimes = yield* MemoryRuntime.MemoryRuntime;
    const memory = yield* MemoryService.MemoryService;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const bind = Effect.fn("PeerMemoryMcpService.bind")(function* (
      input?: { readonly workspace?: string | undefined; readonly project?: string | undefined },
      sharedRead = false,
    ) {
      // Tools listed while memory was on refuse their calls once it is turned off.
      yield* active.pipe(
        Effect.mapError(
          (error) =>
            new OrchestratorMcpFailure({ code: "capability_denied", message: error.detail }),
        ),
      );
      const { caller, scope } = yield* readMutationCaller().pipe(
        Effect.provideService(ThreadManagement.ThreadManagementService, threads),
      );
      if (!sharedRead && caller.interactionMode !== "default")
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "Peer Memory tools require a live default runtime.",
        });
      const session = yield* runtimes
        .runtime(scope.threadId, scope.providerSessionId, scope.providerInstanceId)
        .pipe(Effect.mapError(failure));
      const { mode } = yield* memory.mode(session).pipe(Effect.mapError(failure));
      if (mode === "legacy")
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "Peer Memory is unavailable in legacy mode.",
        });
      if (
        input !== undefined &&
        ((input.workspace !== undefined && input.workspace !== session.workspace) ||
          (input.project !== undefined &&
            input.project !== session.project &&
            !(sharedRead && input.project === "company")))
      )
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "The memory scope is unavailable to this runtime.",
        });
      return session;
    });
    return {
      search: Effect.fn("PeerMemoryMcpService.search")(function* (
        input: RuntimeScoped<PeerHubMemorySearchInput>,
      ) {
        const session = yield* bind(input, true);
        return yield* memory.search(scoped(input, session)).pipe(Effect.mapError(failure));
      }),
      read: Effect.fn("PeerMemoryMcpService.read")(function* (
        input: RuntimeScoped<PeerHubMemoryReadInput>,
      ) {
        const session = yield* bind(input, true);
        return yield* memory.read(scoped(input, session)).pipe(Effect.mapError(failure));
      }),
      changes: Effect.fn("PeerMemoryMcpService.changes")(function* (
        input: RuntimeScoped<PeerHubMemoryChangesInput>,
      ) {
        const session = yield* bind(input, true);
        return yield* memory.changes(scoped(input, session)).pipe(Effect.mapError(failure));
      }),
      project: Effect.fn("PeerMemoryMcpService.project")(function* (
        input: RuntimeScoped<PeerHubMemoryProjectInput>,
      ) {
        const session = yield* bind(input, true);
        return yield* runtimes
          .project(session.sessionId, scoped(input, session))
          .pipe(Effect.mapError(failure));
      }),
      execute: Effect.fn("PeerMemoryMcpService.execute")(function* (
        input: RuntimeScoped<PeerHubMemoryExecuteInput>,
        rememberOnly = false,
      ) {
        if (rememberOnly && input.command.type !== "assertion.record")
          return yield* new OrchestratorMcpFailure({
            code: "invalid_request",
            message: "Remember accepts an assertion.record command.",
          });
        const session = yield* bind(input);
        return yield* runtimes
          .execute(session.sessionId, scoped(input, session))
          .pipe(Effect.mapError(failure));
      }),
      receipt: Effect.fn("PeerMemoryMcpService.receipt")(function* (
        input: Omit<
          PeerMemoryReceiptInput,
          "sessionId" | "environmentId" | "runtimeGeneration" | "runtimeProjectId"
        > & { readonly workspace?: string | undefined; readonly project?: string | undefined },
      ) {
        const session = yield* bind(input, true);
        if (input.state !== "acknowledged" && input.state !== "consumed")
          return yield* new OrchestratorMcpFailure({
            code: "invalid_request",
            message:
              "A runtime acknowledges an exact projection or cites concrete output evidence for consumption.",
          });
        return yield* runtimes.receipt(session.sessionId, input).pipe(Effect.mapError(failure));
      }),
      context: Effect.fn("PeerMemoryMcpService.context")(function* (input: {
        readonly action: "notice" | "checkpoint";
        readonly reason?: string | undefined;
      }) {
        const session = yield* bind();
        return yield* runtimes
          .context(session.sessionId, input.action, input.reason)
          .pipe(Effect.mapError(failure));
      }),
    };
  });
/** @effect-expect-leaking McpInvocationContext */
export class PeerMemoryMcpService extends Context.Service<
  PeerMemoryMcpService,
  Effect.Success<ReturnType<typeof make>>
>()("t3/peerHub/plugins/memory/mcp/PeerMemoryMcpService") {}
export const layer = (active: Effect.Effect<void, PeerHubError>) =>
  Layer.effect(PeerMemoryMcpService, make(active));
