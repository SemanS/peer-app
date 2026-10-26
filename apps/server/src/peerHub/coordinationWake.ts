import { ThreadId, type MessageId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Option from "effect/Option";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderContinuationRequests from "@t3tools/provider-core/server/ProviderContinuationRequests";
import { harnessForDriver } from "./hubPolicy.ts";
import { nativeRuntimePresent } from "./workLifecycle.ts";

/** App-owned native threads must enter through admission, never the CLI's independent queue. */
export const queueCoordinationWake = Effect.fn("PeerHub.queueCoordinationWake")(function* (
  nativeId: string,
  text: string,
  boundThread?: string,
  options?: { readonly agent: string; readonly resume?: boolean; readonly messageId?: MessageId },
) {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const requests = yield* ProviderContinuationRequests.ProviderContinuationRequests;
  const agent = options?.agent ?? "codex";
  let threadId = boundThread?.startsWith("peer:") ? ThreadId.make(boundThread.slice(5)) : undefined;
  if (threadId === undefined) {
    // A hook can arrive before its app binding is persisted. Check historical native
    // refs too: a stopped or replaced app runtime must not fall back to `codex queue`.
    for (const location of ["active", "archive"] as const) {
      const shell = yield* projections.getShellSnapshot({ location });
      for (const thread of shell.threads) {
        const records = yield* projections.getThreadRecords(thread.id, ["providerThreads"]);
        if (
          records.providerThreads.some(
            (provider) =>
              harnessForDriver(provider.driver) === agent &&
              provider.nativeThreadRef?.nativeId === nativeId,
          )
        ) {
          threadId = thread.id;
          break;
        }
      }
      if (threadId !== undefined) break;
    }
  }
  if (threadId === undefined) return "unbound" as const;
  const id = threadId;
  const current = Effect.gen(function* () {
    const shell = yield* projections.getThreadShell(id);
    if (shell === null || shell.archivedAt !== null || shell.deletedAt !== null) return undefined;
    const records = yield* projections.getThreadRecords(id, [
      "providerThreads",
      "providerSessions",
    ]);
    const provider = records.providerThreads.find(
      (entry) => entry.id === shell.activeProviderThreadId,
    );
    const released = records.providerSessions.find(
      (session) => session.id === provider?.providerSessionId,
    );
    return provider?.nativeThreadRef?.nativeId === nativeId &&
      harnessForDriver(provider.driver) === agent &&
      (nativeRuntimePresent(provider, records.providerSessions) ||
        (options?.resume === true &&
          provider.status === "idle" &&
          released?.status === "stopped" &&
          released.resumeOnWake === true))
      ? provider
      : undefined;
  });
  const provider = yield* current;
  if (provider === undefined) return "unavailable" as const;
  const admitted = yield* Deferred.make<boolean>();
  const reject = () => Deferred.succeed(admitted, false).pipe(Effect.asVoid);
  yield* requests.offer({
    threadId: id,
    providerThreadId: provider.id,
    driver: provider.driver,
    detail: text,
    ...(options?.messageId === undefined ? {} : { messageId: options.messageId }),
    delivery: "message_text",
    clearIfCurrent: reject,
    onDispatchFailure: reject,
    notification: {
      source: { kind: "background_task" },
      outcome: "updated",
      summary: "Peer coordination update",
      detail: text,
    },
    // Closing, replacing, or manually stopping the runtime while queued revokes this wake.
    dispatchIfCurrent: (effect) =>
      Effect.gen(function* () {
        const latest = yield* current.pipe(Effect.orElseSucceed(() => undefined));
        if (latest?.id !== provider.id || latest.providerSessionId !== provider.providerSessionId) {
          yield* reject();
          return Option.none();
        }
        const result = yield* effect;
        yield* Deferred.succeed(admitted, true);
        return Option.some(result);
      }),
  });
  return (yield* Deferred.await(admitted)) ? ("queued" as const) : ("unavailable" as const);
});

/** Whether an admitted update can still start or reach its original native runtime. */
export const coordinationWakePending = Effect.fn("PeerHub.coordinationWakePending")(function* (
  session: string,
  thread: string,
  messageId: MessageId,
) {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const id = ThreadId.make(thread.replace(/^peer:/, ""));
  const shell = yield* projections.getThreadShell(id);
  if (shell === null || shell.archivedAt !== null || shell.deletedAt !== null) return false;
  const records = yield* projections.getThreadRecords(id, [
    "providerThreads",
    "providerSessions",
    "runs",
  ]);
  const provider = records.providerThreads.find(
    (entry) => entry.id === shell.activeProviderThreadId,
  );
  const separator = session.indexOf(":");
  if (
    provider === undefined ||
    harnessForDriver(provider.driver) !== session.slice(0, separator) ||
    provider.nativeThreadRef?.nativeId !== session.slice(separator + 1)
  )
    return false;
  const run = records.runs.find((entry) => entry.userMessageId === messageId);
  if (run?.providerThreadId != null && run.providerThreadId !== provider.id) return false;
  return (
    nativeRuntimePresent(provider, records.providerSessions) ||
    (run !== undefined &&
      ["preparing", "queued", "starting", "running", "waiting"].includes(run.status))
  );
});
