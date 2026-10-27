import {
  PEER_LOCAL_WORKSPACE,
  PeerHubError,
  type PeerContextViewInput,
  type PeerConversationReport,
  type PeerHubStatus,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as ProjectionStore from "../../../orchestration-v2/ProjectionStore.ts";
import * as PeerStatus from "../status/PeerStatus.ts";
import * as PeerWork from "../work/PeerWork.ts";
import { shellStatus, taskNamed } from "../work/report.ts";
import { contextPage } from "./contextView.ts";

type Item = PeerConversationReport["items"][number] & { readonly task?: string | undefined };
type Place = Pick<PeerContextViewInput, "workspace" | "project">;
interface Job {
  readonly place: Place;
  pending: boolean;
  updatedAt: string | null;
  checkedAt: string | null;
  error: string | null;
  items: readonly Item[];
  cache: Map<string, { revision: string; item: Item }>;
}
const emptyCoverage = { total: 0, omittedCount: 0, nextCursor: null, historyAvailableFrom: null };
const clip = (text: string, limit: number) => {
  const value = text.trim();
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
};
const revision = (thread: OrchestrationV2ThreadShell) =>
  JSON.stringify([
    thread.updatedAt,
    thread.visibleItemCount,
    thread.latestVisibleMessage,
    thread.latestUserMessageAt,
    thread.status,
    thread.pendingRuntimeRequest,
    thread.archivedAt,
    thread.title,
    thread.activityRunStatus,
    thread.settledAt,
  ]);
const keyOf = (place: Place, status: PeerHubStatus) =>
  JSON.stringify([
    status.environmentId,
    status.hubUrl,
    status.email,
    place.workspace,
    place.project,
  ]);
const projectOf = (place: Place, status: PeerHubStatus) =>
  status.workspaces
    .find((workspace) => workspace.slug === place.workspace)
    ?.projects.find((project) => project.project.id === place.project);
const projectIds = (place: Place, status: PeerHubStatus) =>
  place.workspace === PEER_LOCAL_WORKSPACE
    ? (status.coordination.local?.projects ?? [])
        .filter((project) => project.id === place.project)
        .map((project) => project.projectId)
    : (projectOf(place, status)?.repositories ?? []).flatMap((repository) =>
        repository.projectId === undefined ? [] : [repository.projectId],
      );
const allowed = (place: Place, status: PeerHubStatus) =>
  place.workspace === PEER_LOCAL_WORKSPACE
    ? projectIds(place, status).length > 0
    : status.signedIn && projectOf(place, status) !== undefined;

export class PeerConversationReportService extends Context.Service<
  PeerConversationReportService,
  {
    readonly read: (
      input: PeerContextViewInput,
      status: PeerHubStatus,
    ) => Effect.Effect<PeerConversationReport, PeerHubError>;
    readonly refresh: Effect.Effect<void>;
  }
>()("t3/peerHub/core/index/PeerConversationReport") {}

const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const work = yield* PeerWork.PeerWork;
  const statusService = yield* PeerStatus.PeerStatus;
  const scope = yield* Effect.scope;
  const jobs = new Map<string, Job>();
  const collectionSlots = yield* Semaphore.make(2);

  const conversation = Effect.fnUntraced(function* (thread: OrchestrationV2ThreadShell) {
    let afterPosition: number | undefined;
    let request: string | null = null;
    let response: string | null = null;
    let responseAt: string | null = null;
    let messages = 0;
    let truncated = false;
    // Page the visible history, including inherited and imported messages, without keeping it all.
    while (true) {
      const page = yield* projections.getTimelinePage(thread.id, {
        view: "messages",
        limit: 100,
        ...(afterPosition === undefined ? {} : { afterPosition }),
      });
      for (const { item } of page.items) {
        if (item.type === "user_message") {
          messages++;
          // Coordination wakes and agent messages also use the user role.
          if (item.createdBy === "user") {
            request =
              clip(item.text, 1_200) ||
              (item.attachments.length > 0 ? "Request contains attachments." : null);
            response = null;
            responseAt = null;
            truncated = item.text.trim().length > 1_200;
          }
        } else if (item.type === "assistant_message" && item.text.trim() !== "") {
          messages++;
          response = clip(item.text, 2_400);
          responseAt = DateTime.formatIso(item.updatedAt);
          truncated = (request?.endsWith("…") ?? false) || item.text.trim().length > 2_400;
        }
      }
      if (!page.hasMore) break;
      const next = page.items.at(-1)?.position;
      if (next === undefined || next === afterPosition)
        return yield* Effect.fail(
          new PeerHubError({ detail: "Conversation history could not be paged." }),
        );
      afterPosition = next;
    }
    return { request, response, responseAt, messages, truncated };
  });

  const collect = Effect.fnUntraced(function* (job: Job, status: PeerHubStatus) {
    const project = projectOf(job.place, status);
    const tasks = project?.work.tasks ?? [];
    const assignments = project?.work.assignments ?? {};
    const snapshots = yield* Effect.forEach(
      [...new Set(projectIds(job.place, status))],
      (projectId) => projections.getShellSnapshot({ projectId }),
      { concurrency: 2 },
    );
    const threads = new Map(
      snapshots
        .flatMap((snapshot) => [...snapshot.threads, ...snapshot.archivedThreads])
        .filter((thread) => thread.deletedAt === null)
        .map((thread) => [thread.id, thread]),
    );
    const nextCache = new Map<string, { revision: string; item: Item }>();
    const items: Item[] = yield* Effect.forEach(
      [...threads.values()],
      (thread) =>
        Effect.gen(function* () {
          const id = `peer:${thread.id}`;
          const sourceRevision = revision(thread);
          const task =
            assignments[id] ?? taskNamed(tasks, [thread.branch ?? undefined, thread.title]);
          const previous = job.cache.get(id);
          if (previous?.revision === sourceRevision && previous.item.availability === "available") {
            const cached = { ...previous.item, task };
            nextCache.set(id, { revision: sourceRevision, item: cached });
            return cached;
          }
          const base: Item = {
            id,
            threadId: thread.id,
            title: thread.title,
            status: shellStatus(thread),
            archived: thread.archivedAt !== null,
            updatedAt: DateTime.formatIso(thread.updatedAt),
            request: null,
            response: null,
            responseAt: null,
            messages: 0,
            availability: "unavailable",
            truncated: false,
            task,
          };
          const result = yield* conversation(thread).pipe(
            Effect.timeout("20 seconds"),
            Effect.result,
          );
          if (result._tag === "Failure") return base;
          // A turn may have changed while its pages were read. Retry it on the next background pass.
          const current = yield* projections
            .getThreadShell(thread.id)
            .pipe(Effect.orElseSucceed(() => null));
          const item: Item = {
            ...base,
            ...result.success,
            availability:
              current !== null && revision(current) === sourceRevision ? "available" : "partial",
          };
          nextCache.set(id, { revision: sourceRevision, item });
          return item;
        }),
      { concurrency: 2 },
    );

    const runtime = status.agents.list.filter(
      (agent) => agent.workspace === job.place.workspace && agent.projectId === job.place.project,
    );
    for (const agent of runtime) {
      const record = project?.work.threads.find(
        (thread) =>
          thread.environment === status.environmentId &&
          thread.email === status.email &&
          (thread.id === agent.id ||
            (thread.previousId === agent.id &&
              (agent.branch === undefined || thread.branch === agent.branch))),
      );
      const id = record?.id ?? agent.id;
      const view = yield* work.view(agent.id).pipe(
        Effect.timeout("5 seconds"),
        Effect.orElseSucceed(() => null),
      );
      const entries = view?.entries ?? [];
      const lastPrompt = entries.findLastIndex((entry) => entry.kind === "prompt");
      const prompt = lastPrompt < 0 ? undefined : entries[lastPrompt];
      const answer = entries.slice(lastPrompt + 1).findLast((entry) => entry.kind === "text");
      items.push({
        id,
        threadId: null,
        title: agent.title,
        status: agent.status,
        archived: false,
        updatedAt: null,
        request: prompt?.kind === "prompt" ? clip(prompt.text, 1_200) : null,
        response: answer?.kind === "text" ? clip(answer.text, 2_400) : null,
        responseAt: null,
        messages: entries.filter((entry) => entry.kind !== "tool").length,
        availability: entries.length > 0 ? "partial" : "unavailable",
        truncated: true,
        task:
          assignments[id] ??
          assignments[agent.id] ??
          record?.task ??
          taskNamed(tasks, [agent.branch, agent.title]),
      });
    }
    const included = new Set(items.map((item) => item.id));
    for (const thread of project?.work.threads ?? []) {
      const local = thread.environment === status.environmentId && thread.email === status.email;
      if (
        local &&
        (included.has(thread.id) ||
          (thread.previousId !== undefined && included.has(thread.previousId)))
      )
        continue;
      const seenAt = Date.parse(thread.seenAt);
      const stale =
        thread.runtimePresent === false ||
        !Number.isFinite(seenAt) ||
        Date.now() - seenAt >= 3 * 60_000;
      // Other people's private transcripts never become a project-wide summary via the Hub.
      items.push({
        id: `${thread.environment}:${thread.email}:${thread.id}`,
        threadId: null,
        title: thread.title,
        status: stale ? "unknown" : thread.status,
        archived: thread.delivery === "closed",
        updatedAt: null,
        request: null,
        response: null,
        responseAt: null,
        messages: 0,
        availability: "unavailable",
        truncated: false,
        task: thread.task,
      });
    }
    items.sort(
      (a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.id.localeCompare(b.id),
    );
    const now = DateTime.formatIso(yield* DateTime.now);
    if (job.updatedAt === null || JSON.stringify(items) !== JSON.stringify(job.items))
      job.updatedAt = now;
    job.items = items;
    job.cache = nextCache;
    job.checkedAt = now;
    job.error = null;
  });

  const ensure = Effect.fnUntraced(function* (
    place: Place,
    status: PeerHubStatus,
    minimumAge = 30_000,
  ) {
    const key = keyOf(place, status);
    let job = jobs.get(key);
    if (job === undefined) {
      job = {
        place,
        pending: false,
        updatedAt: null,
        checkedAt: null,
        error: null,
        items: [],
        cache: new Map(),
      };
      jobs.set(key, job);
    }
    if (
      !job.pending &&
      (job.checkedAt === null || Date.now() - Date.parse(job.checkedAt) >= minimumAge)
    ) {
      job.pending = true;
      const target = job;
      yield* Effect.suspend(() =>
        jobs.get(key) === target ? collect(target, status) : Effect.void,
      ).pipe(
        collectionSlots.withPermits(1),
        Effect.catchCause(() =>
          Effect.sync(() => {
            target.error = "Could not update conversations. Peer will retry automatically.";
            target.checkedAt = new Date().toISOString();
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            target.pending = false;
          }),
        ),
        Effect.forkIn(scope),
      );
    }
    return job;
  });

  const read: PeerConversationReportService["Service"]["read"] = Effect.fnUntraced(
    function* (input, status) {
      if (!allowed(input, status))
        return {
          state: "unavailable",
          updatedAt: null,
          checkedAt: null,
          error: "Conversations are unavailable for this project on this environment.",
          total: 0,
          available: 0,
          working: 0,
          waiting: 0,
          items: [],
          coverage: emptyCoverage,
        } satisfies PeerConversationReport;
      const job = yield* ensure(input, status, 5_000);
      const items = input.scope.startsWith("task:")
        ? job.items.filter((item) => item.task === input.scope.slice(5))
        : job.items;
      const available = items.filter((item) => item.availability === "available").length;
      const page = yield* Effect.try({
        try: () =>
          contextPage(
            items,
            `${keyOf(input, status)}:${input.scope}`,
            input.limit ?? 20,
            input.conversationCursor,
          ),
        catch: (cause) =>
          Schema.is(PeerHubError)(cause)
            ? cause
            : new PeerHubError({ detail: "Could not page the conversation report." }),
      });
      return {
        state: job.pending
          ? "updating"
          : job.error !== null
            ? "error"
            : items.length > 0 && items.every((item) => item.availability === "unavailable")
              ? "unavailable"
              : available < items.length
                ? "partial"
                : "current",
        updatedAt: job.updatedAt,
        checkedAt: job.checkedAt,
        error: job.error,
        total: items.length,
        available,
        working: items.filter((item) => item.status === "working").length,
        waiting: items.filter((item) => item.status === "blocked").length,
        items: page.selected,
        coverage: page.coverage,
      } satisfies PeerConversationReport;
    },
  );
  const refresh = Effect.gen(function* () {
    const status = yield* statusService.publish;
    const places: Place[] = [
      ...(status.coordination.local?.projects ?? []).map((project) => ({
        workspace: PEER_LOCAL_WORKSPACE,
        project: project.id,
      })),
      ...status.workspaces.flatMap((workspace) =>
        workspace.projects.map((project) => ({
          workspace: workspace.slug,
          project: project.project.id,
        })),
      ),
    ];
    const active = new Set(
      places.filter((place) => allowed(place, status)).map((place) => keyOf(place, status)),
    );
    for (const key of jobs.keys()) if (!active.has(key)) jobs.delete(key);
    for (const place of places) if (allowed(place, status)) yield* ensure(place, status);
  });
  return PeerConversationReportService.of({ read, refresh });
});
export const layer = Layer.effect(PeerConversationReportService, make);
