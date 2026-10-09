import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { brokerFixture } from "./testkit.ts";
describe("plugin context snapshots", () => {
  it.effect(
    "copies only declared reads and the cached shared context without mutating receipt ledgers",
    () =>
      Effect.gen(function* () {
        const fixture = yield* Effect.promise(() => brokerFixture());
        try {
          yield* Effect.promise(() => fixture.register("one"));
          const session = fixture.broker.sessions.get("claude:one")!;
          session.read.set("task:other", {
            version: 3,
            text: "## Provides\n- `formatPrice`: returns cents",
            notifiedVersion: 4,
            toldAt: 0,
          });
          fixture.broker.shared.set(
            fixture.broker.sharedKey(session.workspace, session.project, "project"),
            {
              workspace: session.workspace,
              project: session.project,
              scope: "project",
              path: "/unused",
              version: 5,
              text: "Current own contract",
              keeper: undefined,
              updatedAt: "2026-10-09T12:00:00Z",
              updatedBy: undefined,
              updatedSession: undefined,
              restoredFrom: undefined,
              unsent: false,
              pushing: undefined,
            },
          );
          const view = fixture.broker.sessionView(session);
          expect(view.contextReads).toEqual([
            {
              scope: "task:other",
              version: 3,
              text: "## Provides\n- `formatPrice`: returns cents",
            },
          ]);
          expect(view.sharedContext).toEqual({
            scope: "project",
            version: 5,
            text: "Current own contract",
          });
          session.read.set("task:other", {
            version: 6,
            text: "New read",
            notifiedVersion: 6,
            toldAt: 0,
          });
          expect(view.contextReads?.[0]?.version).toBe(3);
          expect(session.read.get("task:other")?.version).toBe(6);
          expect(fixture.broker.sessionView(session).contextReads?.[0]?.text).toBe("New read");
        } finally {
          yield* Effect.promise(() => fixture.dispose());
        }
      }),
  );
});
