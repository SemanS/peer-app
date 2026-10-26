import { describe, expect, it } from "@effect/vitest";
import {
  ThreadId,
  MessageId,
  ProviderThreadId,
  ProviderDriverKind,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderContinuationRequests from "@t3tools/provider-core/server/ProviderContinuationRequests";
import { queueCoordinationWake, coordinationWakePending } from "./coordinationWake.ts";

const threadId = ThreadId.make("thread-peer-wake");
const wakeMessageId = MessageId.make("coordination-wake-message");
const providerId = ProviderThreadId.make("provider-peer-wake");
const fixture = () => {
  const state = {
    archived: false,
    runtime: "ready",
    nativeId: "native-one",
    available: true,
    reject: false,
    driver: "codex",
    resumeOnWake: false,
    deleted: false,
    runStatus: "queued",
    messageId: wakeMessageId as string,
  };
  const offered: ProviderContinuationRequests.ProviderContinuationRequest[] = [];
  const shell = () =>
    ({
      id: threadId,
      activeProviderThreadId: providerId,
      archivedAt: state.archived ? "2026-10-07" : null,
      deletedAt: state.deleted ? "2026-10-07" : null,
    }) as unknown as OrchestrationV2ThreadShell;
  const layer = Layer.merge(
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getThreadShell: () => Effect.succeed(state.available ? shell() : null),
      getShellSnapshot: ({ location }: { readonly location?: "active" | "archive" } = {}) =>
        Effect.succeed({
          threads: state.available && (location === "archive") === state.archived ? [shell()] : [],
        } as never),
      getThreadRecords: () =>
        Effect.succeed({
          providerThreads: [
            {
              id: providerId,
              driver: ProviderDriverKind.make(state.driver),
              status: "idle",
              providerSessionId: "session-one",
              nativeThreadRef: { nativeId: state.nativeId },
            },
          ],
          providerSessions: [
            { id: "session-one", status: state.runtime, resumeOnWake: state.resumeOnWake },
          ],
          runs: [
            {
              userMessageId: state.messageId,
              providerThreadId: providerId,
              status: state.runStatus,
            },
          ],
        } as never),
    }),
    Layer.succeed(ProviderContinuationRequests.ProviderContinuationRequests, {
      offer: (request) =>
        Effect.gen(function* () {
          offered.push(request);
          if (state.reject) yield* request.onDispatchFailure?.() ?? Effect.void;
          else yield* request.dispatchIfCurrent?.(Effect.void) ?? Effect.void;
        }),
      take: Effect.never,
    }),
  );
  return { state, offered, layer };
};

describe("admitted coordination wake lifecycle", () => {
  it.effect.each(["preparing", "queued", "starting", "running", "waiting"])(
    "protects the exact wake's %s run before broker enrollment",
    (status) => {
      const f = fixture();
      f.state.runtime = "stopped";
      f.state.runStatus = status;
      return Effect.gen(function* () {
        expect(
          yield* coordinationWakePending("codex:native-one", `peer:${threadId}`, wakeMessageId),
        ).toBe(true);
      }).pipe(Effect.provide(f.layer));
    },
  );

  it.effect.each(["cancelled", "interrupted", "completed", "failed"])(
    "releases an abandoned wake after its run is %s",
    (status) => {
      const f = fixture();
      f.state.runtime = "stopped";
      f.state.runStatus = status;
      return Effect.gen(function* () {
        expect(
          yield* coordinationWakePending("codex:native-one", `peer:${threadId}`, wakeMessageId),
        ).toBe(false);
      }).pipe(Effect.provide(f.layer));
    },
  );

  it.effect.each(["deleted", "archived", "replaced", "missing"])(
    "releases the accepted wake when its thread is %s",
    (reason) => {
      const f = fixture();
      if (reason === "deleted") f.state.deleted = true;
      if (reason === "archived") f.state.archived = true;
      if (reason === "replaced") f.state.nativeId = "another-native";
      if (reason === "missing") f.state.available = false;
      return Effect.gen(function* () {
        expect(
          yield* coordinationWakePending("codex:native-one", `peer:${threadId}`, wakeMessageId),
        ).toBe(false);
      }).pipe(Effect.provide(f.layer));
    },
  );

  it.effect(
    "checks the admitted message rather than another queued message, while preserving a starting native runtime",
    () => {
      const f = fixture();
      f.state.runtime = "stopped";
      f.state.messageId = "another-message";
      return Effect.gen(function* () {
        expect(
          yield* coordinationWakePending("codex:native-one", `peer:${threadId}`, wakeMessageId),
        ).toBe(false);
        f.state.runtime = "starting";
        expect(
          yield* coordinationWakePending("codex:native-one", `peer:${threadId}`, wakeMessageId),
        ).toBe(true);
      }).pipe(Effect.provide(f.layer));
    },
  );
});

describe("Peer coordination wake admission", () => {
  it.effect.each([
    ["codex", "codex"],
    ["claudeAgent", "claude"],
  ] as const)(
    "resumes an idle-released %s conversation in its original app thread",
    ([driver, agent]) => {
      const f = fixture();
      f.state.driver = driver;
      f.state.runtime = "stopped";
      f.state.resumeOnWake = true;
      return Effect.gen(function* () {
        expect(
          yield* queueCoordinationWake(
            "native-one",
            "The agreement is confirmed",
            `peer:${threadId}`,
            {
              agent,
              resume: true,
              messageId: wakeMessageId,
            },
          ),
        ).toBe("queued");
        expect(f.offered[0]).toMatchObject({
          threadId,
          providerThreadId: providerId,
          driver,
          delivery: "message_text",
          detail: "The agreement is confirmed",
        });
        f.state.resumeOnWake = false;
        let sent = false;
        expect(
          Option.isNone(
            yield* f.offered[0]!.dispatchIfCurrent!(
              Effect.sync(() => {
                sent = true;
              }),
            ),
          ),
        ).toBe(true);
        expect(sent).toBe(false);
      }).pipe(Effect.provide(f.layer));
    },
  );

  it.effect("returns failure to retain pending news when continuation admission fails", () => {
    const f = fixture();
    f.state.reject = true;
    return Effect.gen(function* () {
      expect(
        yield* queueCoordinationWake("native-one", "Keep this update", `peer:${threadId}`),
      ).toBe("unavailable");
      expect(f.offered).toHaveLength(1);
    }).pipe(Effect.provide(f.layer));
  });
  it.effect("admits a resident app thread as a message-text continuation", () => {
    const f = fixture();
    return Effect.gen(function* () {
      expect(
        yield* queueCoordinationWake("native-one", "Read context v2", `peer:${threadId}`),
      ).toBe("queued");
      expect(f.offered[0]).toMatchObject({
        threadId,
        providerThreadId: providerId,
        delivery: "message_text",
        detail: "Read context v2",
      });
      expect(Option.isSome(yield* f.offered[0]!.dispatchIfCurrent!(Effect.succeed("sent")))).toBe(
        true,
      );
      f.state.runtime = "stopped";
      let ran = false;
      expect(
        Option.isNone(
          yield* f.offered[0]!.dispatchIfCurrent!(
            Effect.sync(() => {
              ran = true;
            }),
          ),
        ),
      ).toBe(true);
      expect(ran).toBe(false);
    }).pipe(Effect.provide(f.layer));
  });

  it.effect("finds app ownership before a hook has its app binding", () => {
    const f = fixture();
    return Effect.gen(function* () {
      expect(yield* queueCoordinationWake("native-one", "Update")).toBe("queued");
      f.state.archived = true;
      expect(yield* queueCoordinationWake("native-one", "Update")).toBe("unavailable");
      expect(f.offered).toHaveLength(1);
    }).pipe(Effect.provide(f.layer));
  });

  it.effect(
    "never falls back to native queue for a stopped, replaced, or missing bound thread",
    () => {
      const f = fixture();
      return Effect.gen(function* () {
        f.state.runtime = "stopped";
        expect(yield* queueCoordinationWake("native-one", "Update", `peer:${threadId}`)).toBe(
          "unavailable",
        );
        f.state.runtime = "ready";
        f.state.nativeId = "replacement";
        expect(yield* queueCoordinationWake("native-one", "Update", `peer:${threadId}`)).toBe(
          "unavailable",
        );
        f.state.available = false;
        expect(yield* queueCoordinationWake("native-one", "Update", `peer:${threadId}`)).toBe(
          "unavailable",
        );
        expect(f.offered).toHaveLength(0);
        expect(yield* queueCoordinationWake("external-native", "Update")).toBe("unbound");
      }).pipe(Effect.provide(f.layer));
    },
  );
});

it.effect("retains the wake message identity through continuation admission", () => {
  const f = fixture();
  return Effect.gen(function* () {
    yield* queueCoordinationWake("native-one", "An update", `peer:${threadId}`, {
      agent: "codex",
      messageId: wakeMessageId,
    });
    expect(f.offered[0]?.messageId).toBe(wakeMessageId);
  }).pipe(Effect.provide(f.layer));
});
