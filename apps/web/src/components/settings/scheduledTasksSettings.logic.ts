import {
  EnvironmentId,
  type ProjectId,
  ScheduledTaskId,
  type ScheduledTask,
  type ScheduledTaskUpsertSchedule,
  type ModelSelection,
  type RuntimeMode,
  type ProviderInteractionMode,
  type ServerSettings,
} from "@t3tools/contracts";
import { parseMaxDeliveryAge } from "@t3tools/client-runtime/scheduled-task-webhook";

import {
  resolveProjectSettings,
  type LegacyProjectSettingsFields,
} from "@t3tools/shared/projectSettings";
import type { ProviderInstanceEntry } from "../../providerInstances";

import { DEFAULT_CATCH_UP_MS } from "./scheduleTime.logic";
import type { ResolvedSettingsScope } from "./settingsScope";

export function matchesScheduledTaskScope(
  scope: ResolvedSettingsScope,
  environmentId: EnvironmentId,
  projectId: ProjectId,
): boolean {
  if (scope.kind === "unavailable" || !scope.environmentIds.includes(environmentId)) return false;
  if (scope.kind === "project" || scope.kind === "checkout") {
    return scope.members.some(
      (member) => member.environmentId === environmentId && member.id === projectId,
    );
  }
  return true;
}

export function validateScheduledTasksSearch(raw: Record<string, unknown>) {
  return {
    ...(typeof raw.environmentId === "string" && raw.environmentId.trim()
      ? { environmentId: EnvironmentId.make(raw.environmentId) }
      : {}),
    ...(typeof raw.taskId === "string" && raw.taskId.trim()
      ? { taskId: ScheduledTaskId.make(raw.taskId) }
      : {}),
  };
}

export type ScheduleMode = "fixed" | "interval" | "webhook";
export type WorkspaceMode = "root" | "worktree" | "existing_worktree";

export interface DraftState {
  readonly editingId: string | null;
  readonly title: string;
  readonly prompt: string;
  readonly enabled: boolean;
  readonly scheduleMode: ScheduleMode;
  readonly intervalMinutes: string;
  readonly timeOfDay: string;
  readonly weekdays: ReadonlySet<number>;
  /** The IANA zone a fixed-time schedule runs in; "" runs it in the computer's own. */
  readonly timeZone: string;
  /** What a run the computer slept through becomes: run once when it wakes, or skipped. */
  readonly missedRun: "catch_up" | "skip";
  /** How long after the scheduled time a caught-up run may still happen. */
  readonly catchUpMs: number;
  readonly projectId: string;
  readonly threadId: string;
  readonly workspaceMode: WorkspaceMode;
  readonly baseRef: string;
  readonly startFromOrigin: boolean;
  readonly existingWorktreePath: string;
  readonly modelKey: string;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  /**
   * The picker only edits `instanceId:model`; keeping the source object preserves provider
   * options (reasoning, temperature, …) when the model itself is left unchanged.
   */
  readonly baseModelSelection: ModelSelection | null;
  readonly signatureEnabled: boolean;
  readonly signatureHeader: string;
  readonly signatureEncoding: "hex" | "base64";
  readonly signaturePrefix: string;
  /** Write-only: empty keeps the secret already stored on the server. */
  readonly signatureSecret: string;
  readonly maxDeliveryAgeMinutes: string;
}

export const WEBHOOK_SIGNATURE_DEFAULTS = {
  signatureHeader: "x-hub-signature-256",
  signatureEncoding: "hex",
  signaturePrefix: "sha256=",
} as const;

/**
 * The schedule a draft saves, or null for a webhook whose age limit is not a number of minutes. A
 * fixed-time one carries its zone (none for the computer's own) and what to do with a missed run,
 * unless `zones` says the server does not read them: an older server runs the time of day in its
 * own zone and skips a missed run, and says nothing else is possible.
 */
export function scheduleFromDraft(
  draft: DraftState,
  options: { readonly zones: boolean },
): ScheduledTaskUpsertSchedule | null {
  if (draft.scheduleMode === "webhook") {
    const maxDeliveryAgeMinutes = parseMaxDeliveryAge(draft.maxDeliveryAgeMinutes);
    if (maxDeliveryAgeMinutes === undefined) return null;
    const secret = draft.signatureSecret.trim();
    return {
      type: "webhook",
      signature: draft.signatureEnabled
        ? {
            header: draft.signatureHeader.trim(),
            encoding: draft.signatureEncoding,
            prefix: draft.signaturePrefix,
            ...(secret ? { secret } : {}),
          }
        : null,
      maxDeliveryAgeMinutes,
    };
  }
  if (draft.scheduleMode === "interval") {
    const everyMs = Math.round(Number(draft.intervalMinutes) * 60_000);
    return { type: "interval", everyMs };
  }
  const selectedEveryDay = draft.weekdays.size === 0 || draft.weekdays.size === 7;
  return {
    type: "fixed_time",
    timeOfDay: draft.timeOfDay || "09:00",
    ...(selectedEveryDay ? {} : { weekdays: [...draft.weekdays].toSorted() }),
    ...(options.zones && draft.timeZone !== "" ? { timeZone: draft.timeZone } : {}),
    ...(options.zones
      ? {
          missedRun:
            draft.missedRun === "catch_up"
              ? ({ type: "catch_up", withinMs: draft.catchUpMs } as const)
              : ({ type: "skip" } as const),
        }
      : {}),
  };
}

export function taskToDraft(task: ScheduledTask): DraftState {
  const schedule = task.schedule;
  const fixed = schedule.type === "fixed_time" ? schedule : null;
  const catchUp = fixed?.missedRun?.type === "catch_up" ? fixed.missedRun : null;
  const weekdays =
    schedule.type === "fixed_time" && schedule.weekdays && schedule.weekdays.length > 0
      ? new Set(schedule.weekdays)
      : new Set([0, 1, 2, 3, 4, 5, 6]);
  return {
    editingId: task.id,
    title: task.title,
    prompt: task.prompt,
    enabled: task.enabled,
    scheduleMode:
      schedule.type === "interval" ? "interval" : schedule.type === "webhook" ? "webhook" : "fixed",
    intervalMinutes:
      schedule.type === "interval" ? String(Math.max(1, schedule.everyMs / 60_000)) : "15",
    timeOfDay: schedule.type === "fixed_time" ? schedule.timeOfDay : "09:00",
    weekdays,
    timeZone: fixed?.timeZone ?? "",
    // A schedule that says nothing skips a run later than a short grace period: the form says so.
    missedRun: catchUp === null ? "skip" : "catch_up",
    catchUpMs: catchUp?.withinMs ?? DEFAULT_CATCH_UP_MS,
    projectId: task.projectId,
    threadId: task.threadId ?? "",
    workspaceMode: task.workspaceStrategy.type,
    baseRef: task.workspaceStrategy.type === "worktree" ? task.workspaceStrategy.baseRef : "main",
    startFromOrigin:
      task.workspaceStrategy.type === "worktree"
        ? (task.workspaceStrategy.startFromOrigin ?? false)
        : true,
    existingWorktreePath:
      task.workspaceStrategy.type === "existing_worktree"
        ? task.workspaceStrategy.worktreePath
        : "",
    modelKey: `${task.modelSelection.instanceId}:${task.modelSelection.model}`,
    runtimeMode: task.runtimeMode,
    interactionMode: task.interactionMode,
    baseModelSelection: task.modelSelection,
    ...(schedule.type === "webhook" && schedule.signature !== null
      ? {
          signatureEnabled: true,
          signatureHeader: schedule.signature.header,
          signatureEncoding: schedule.signature.encoding,
          signaturePrefix: schedule.signature.prefix,
        }
      : { signatureEnabled: false, ...WEBHOOK_SIGNATURE_DEFAULTS }),
    signatureSecret: "",
    maxDeliveryAgeMinutes:
      schedule.type === "webhook" && schedule.maxDeliveryAgeMinutes != null
        ? String(schedule.maxDeliveryAgeMinutes)
        : "",
  };
}

export function scheduledTaskDefaultModel(
  settings: ServerSettings,
  project: (LegacyProjectSettingsFields & { readonly id: ProjectId }) | null,
  entries: readonly ProviderInstanceEntry[],
): ModelSelection | null {
  const available = entries.filter(
    (entry) =>
      entry.enabled &&
      entry.installed &&
      entry.isAvailable &&
      entry.snapshot.auth.status !== "unauthenticated",
  );
  const configured = resolveProjectSettings(settings, project?.id ?? null, project).settings
    .defaultModelSelection;
  for (const selection of [configured, settings.defaultModelSelection]) {
    if (
      selection &&
      available.some(
        (entry) =>
          entry.instanceId === selection.instanceId &&
          entry.models.find((model) => model.slug === selection.model)?.isLegacy !== true,
      )
    )
      return selection;
  }
  const models = available.flatMap((entry) =>
    entry.models
      .filter((model) => !model.isLegacy)
      .map((model) => ({ instanceId: entry.instanceId, model })),
  );
  const fallback = models.find(({ model }) => model.isDefault) ?? models[0];
  return fallback ? { instanceId: fallback.instanceId, model: fallback.model.slug } : null;
}
