import * as Scheduler from "../scheduling/Scheduler.ts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { ScheduledTaskUpsertInput } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ScheduledTaskService from "./ScheduledTaskService.ts";

const decodeUpsertInput = Schema.decodeUnknownEffect(ScheduledTaskUpsertInput);

it.effect("rejects a stale form save after deletion while preserving explicit-id creates", () =>
  Effect.gen(function* () {
    const layerDependencies = Layer.mergeAll(
      NodeCrypto.layer,
      Scheduler.layer,
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
      Layer.mock(ThreadManagementService.ThreadManagementService)({}),
      Layer.mock(SecretRequests.SecretRequests)({}),
    );
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const input = yield* decodeUpsertInput({
        id: "scheduled-task:edit-after-delete",
        title: "Review",
        prompt: "Review the open pull requests.",
        enabled: true,
        schedule: { type: "interval", everyMs: 60_000 },
        projectId: "project-stale-schedule",
        workspaceStrategy: { type: "root" },
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      const created = yield* service.upsert(input);
      const edit = yield* decodeUpsertInput({ ...input, requireExisting: true, title: "Edited" });
      expect((yield* service.upsert(edit)).task.title).toBe("Edited");
      yield* service.delete({ id: created.task.id });

      const failure = yield* service.upsert(edit).pipe(Effect.flip);
      expect(failure.message).toBe("Schedule task not found.");
      expect((yield* service.list()).tasks).toEqual([]);

      expect((yield* service.upsert(input)).task.id).toBe(created.task.id);
    }).pipe(Effect.provide(ScheduledTaskService.layer.pipe(Layer.provide(layerDependencies))));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("preserves a due run when a save only pads the scheduled hour", () =>
  Effect.gen(function* () {
    const dueAt = DateTime.makeZonedUnsafe(
      { year: 2026, month: 7, day: 1, hour: 9, minute: 0, second: 0, millisecond: 0 },
      { timeZone: DateTime.zoneMakeLocal(), adjustForTimeZone: true },
    );
    yield* TestClock.setTime(DateTime.toEpochMillis(dueAt) - 1_000);

    const layerDependencies = Layer.mergeAll(
      NodeCrypto.layer,
      Scheduler.layer,
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
      Layer.mock(ThreadManagementService.ThreadManagementService)({}),
      Layer.mock(SecretRequests.SecretRequests)({}),
    );
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const input = yield* decodeUpsertInput({
        commandId: "schedule-time-format",
        title: "Morning review",
        prompt: "Review the open pull requests.",
        enabled: true,
        schedule: { type: "fixed_time", timeOfDay: "9:00" },
        projectId: "project-schedule-time-format",
        workspaceStrategy: { type: "root" },
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        creationSource: "mcp",
      });
      const created = yield* service.upsert(input);
      const expectedDueAt = DateTime.formatIso(DateTime.toUtc(dueAt));
      expect(created.task.nextRunAt).toBe(expectedDueAt);

      yield* TestClock.setTime(DateTime.toEpochMillis(dueAt) + 1_000);
      const update = yield* decodeUpsertInput({
        ...input,
        id: created.task.id,
        schedule: { type: "fixed_time", timeOfDay: "09:00" },
      });
      const updated = yield* service.upsert(update);
      expect(updated.task.nextRunAt).toBe(expectedDueAt);
      expect((yield* service.list()).tasks[0]?.nextRunAt).toBe(expectedDueAt);

      const rescheduled = yield* service.upsert({
        ...update,
        schedule: { type: "fixed_time", timeOfDay: "09:30" },
      });
      expect(rescheduled.task.nextRunAt).toBe(
        DateTime.formatIso(DateTime.toUtc(DateTime.add(dueAt, { minutes: 30 }))),
      );
    }).pipe(Effect.provide(ScheduledTaskService.layer.pipe(Layer.provide(layerDependencies))));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("runs a fixed-time task in its own time zone and tells the form the computer's", () =>
  Effect.gen(function* () {
    // Monday 12 Oct 2026, 16:27 in Bratislava (CEST, UTC+2).
    yield* TestClock.setTime(Date.parse("2026-10-12T14:27:00.000Z"));
    const dependencies = Layer.mergeAll(
      NodeCrypto.layer,
      Scheduler.layer,
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
      Layer.mock(ThreadManagementService.ThreadManagementService)({}),
      Layer.mock(SecretRequests.SecretRequests)({}),
    );
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const schedule = {
        type: "fixed_time",
        timeOfDay: "09:00",
        weekdays: [1, 2, 3, 4, 5],
        timeZone: "Europe/Bratislava",
        missedRun: { type: "catch_up", withinMs: 6 * 3_600_000 },
      } as const;
      const input = yield* decodeUpsertInput({
        commandId: "schedule-time-zone",
        title: "Morning review",
        prompt: "Review the open pull requests.",
        enabled: true,
        schedule,
        projectId: "project-schedule-time-zone",
        workspaceStrategy: { type: "root" },
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      const created = yield* service.upsert(input);
      expect(created.task.nextRunAt).toBe("2026-10-13T07:00:00.000Z");

      // The zone and the rule are kept as saved, and the list names the computer's own zone.
      const listed = yield* service.list();
      expect(listed.tasks[0]?.schedule).toEqual(schedule);
      expect(listed.timeZone).toBe(DateTime.zoneToString(DateTime.zoneMakeLocal()));

      // Another zone restarts the clock.
      const edit = { ...input, id: created.task.id, requireExisting: true };
      const inNewYork = yield* service.upsert({
        ...edit,
        schedule: { ...schedule, timeZone: "America/New_York" },
      });
      expect(inNewYork.task.nextRunAt).toBe("2026-10-13T13:00:00.000Z");

      const unknown = yield* service
        .upsert({ ...edit, schedule: { ...schedule, timeZone: "Mars/Olympus_Mons" } })
        .pipe(Effect.flip);
      expect(unknown.message).toContain("Unknown time zone Mars/Olympus_Mons");
      expect((yield* service.list()).tasks[0]?.nextRunAt).toBe("2026-10-13T13:00:00.000Z");
    }).pipe(Effect.provide(ScheduledTaskService.layer.pipe(Layer.provide(dependencies))));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("keeps a schedule from before time zones running in the computer's zone", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-10-12T14:27:00.000Z"));
    const dependencies = Layer.mergeAll(
      NodeCrypto.layer,
      Scheduler.layer,
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
      Layer.mock(ThreadManagementService.ThreadManagementService)({}),
      Layer.mock(SecretRequests.SecretRequests)({}),
    );
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const schedule = {
        type: "fixed_time",
        timeOfDay: "09:00",
        weekdays: [1, 2, 3, 4, 5],
      } as const;
      const input = yield* decodeUpsertInput({
        commandId: "schedule-before-time-zones",
        title: "Morning review",
        prompt: "Review the open pull requests.",
        enabled: true,
        schedule,
        projectId: "project-schedule-before-time-zones",
        workspaceStrategy: { type: "root" },
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      const created = yield* service.upsert(input);
      // 09:00 on the next weekday, read on the zone this process runs in.
      const local = DateTime.zoneMakeLocal();
      const expected = DateTime.setParts(
        DateTime.add(DateTime.setZone(DateTime.makeUnsafe("2026-10-12T14:27:00.000Z"), local), {
          days: 1,
        }),
        { hour: 9, minute: 0, second: 0, millisecond: 0 },
      );
      expect(created.task.nextRunAt).toBe(DateTime.formatIso(DateTime.toUtc(expected)));
      expect(Object.keys((yield* service.list()).tasks[0]?.schedule ?? {})).toEqual([
        "type",
        "timeOfDay",
        "weekdays",
      ]);
    }).pipe(Effect.provide(ScheduledTaskService.layer.pipe(Layer.provide(dependencies))));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("keeps a due run when a save only changes how a missed run is handled", () =>
  Effect.gen(function* () {
    // 09:00 in Bratislava on Tuesday 13 Oct 2026 is 07:00Z.
    const dueAt = Date.parse("2026-10-13T07:00:00.000Z");
    yield* TestClock.setTime(dueAt - 1_000);
    const dependencies = Layer.mergeAll(
      NodeCrypto.layer,
      Scheduler.layer,
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
      Layer.mock(ThreadManagementService.ThreadManagementService)({}),
      Layer.mock(SecretRequests.SecretRequests)({}),
    );
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const schedule = {
        type: "fixed_time",
        timeOfDay: "09:00",
        timeZone: "Europe/Bratislava",
        missedRun: { type: "catch_up", withinMs: 6 * 3_600_000 },
      } as const;
      const input = yield* decodeUpsertInput({
        commandId: "schedule-missed-run-rule",
        title: "Morning review",
        prompt: "Review the open pull requests.",
        enabled: true,
        schedule,
        projectId: "project-schedule-missed-run-rule",
        workspaceStrategy: { type: "root" },
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      const created = yield* service.upsert(input);
      expect(created.task.nextRunAt).toBe("2026-10-13T07:00:00.000Z");

      // Cross the due time before the scheduler's first five-second tick.
      yield* TestClock.setTime(dueAt + 1_000);
      const skipping = yield* service.upsert({
        ...input,
        id: created.task.id,
        schedule: { ...schedule, missedRun: { type: "skip" } },
      });
      expect(skipping.task.nextRunAt).toBe("2026-10-13T07:00:00.000Z");
      expect(skipping.task.schedule).toEqual({ ...schedule, missedRun: { type: "skip" } });
    }).pipe(Effect.provide(ScheduledTaskService.layer.pipe(Layer.provide(dependencies))));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);
