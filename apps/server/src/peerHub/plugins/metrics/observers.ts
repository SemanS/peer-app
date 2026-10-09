import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { taskRef } from "@t3tools/shared/peerRef";
import type { PeerWorkPass } from "../../core/work/PeerWork.ts";
import type { PersonState } from "./client/localStore.ts";
import type { Collector } from "./rollup.ts";
const addSeen = (keys: string[], key: string) => {
  if (keys.includes(key)) return false;
  keys.push(key);
  if (keys.length > 5000) keys.shift();
  return true;
};
export function createObservers(collector: Pick<Collector, "task" | "pr">) {
  let lastPass = -Infinity;
  return (pass: PeerWorkPass | null, person: PersonState) =>
    Effect.gen(function* () {
      if (!pass || pass.at <= lastPass) return;
      lastPass = pass.at;
      let read = 0;
      for (const thread of pass.threads) {
        const place = pass.projectOf.get(thread.projectId);
        if (!place) continue;
        const workspace = place.workspace.slug,
          project = place.project.id,
          task = pass.assignment(`peer:${thread.id}`, workspace, project);
        if (task)
          for (const link of thread.pullRequests ?? []) {
            if (
              link.source === "stack-dismissed" ||
              link.snapshot?.state !== "open" ||
              !link.snapshot.mergeability ||
              link.snapshot.mergeability === "unknown"
            )
              continue;
            const key = [link.host, link.repository, link.number]
              .map((v) => `${String(v).length}:${v}`)
              .join("|");
            const checked = addSeen(person.checked, key),
              conflicting =
                link.snapshot.mergeability === "conflicting" && addSeen(person.conflicting, key);
            if (person.seededPr && (checked || conflicting))
              collector.pr(workspace, project, checked, conflicting);
          }
        const updated = DateTime.toEpochMillis(thread.updatedAt),
          cursor = person.cursors[thread.id];
        if (cursor && updated <= cursor.updated) continue;
        if (
          ![thread.providerInstanceId, ...(thread.providerInstanceHistory ?? [])].some((id) =>
            pass.sharedInstance.has(id),
          )
        )
          continue;
        if (read++ >= 50) continue;
        const result = yield* pass.turnsOf(thread.id).pipe(Effect.option);
        if (result._tag === "None") continue;
        let completed = cursor?.completed ?? 0;
        for (const turn of result.value.providerTurns) {
          if (!turn.completedAt || turn.status !== "completed") continue;
          const at = DateTime.toEpochMillis(turn.completedAt);
          completed = Math.max(completed, at);
          const provider = result.value.providerThreads.find((p) => p.id === turn.providerThreadId);
          const shared = provider && pass.sharedInstance.get(provider.providerInstanceId);
          if (
            !cursor ||
            at <= cursor.completed ||
            !shared ||
            shared.workspace.slug !== workspace ||
            shared.projectId !== project
          )
            continue;
          const usage = turn.turnTokenUsage;
          collector.task(workspace, project, at, taskRef(task), {
            in: usage?.usageStatus === "unavailable" ? 0 : (usage?.inputTokens ?? 0),
            out: usage?.usageStatus === "unavailable" ? 0 : (usage?.outputTokens ?? 0),
            cached:
              usage?.usageStatus === "unavailable"
                ? 0
                : (usage?.cachedInputTokens ?? 0) + (usage?.cacheCreationTokens ?? 0),
            turns: 1,
            partial: !usage || usage.usageStatus !== "complete" || usage.hasSubagents ? 1 : 0,
          });
        }
        person.cursors[thread.id] = { updated, completed };
      }
      person.seededPr = true;
      const keys = Object.keys(person.cursors);
      for (const key of keys.slice(0, Math.max(0, keys.length - 5000))) delete person.cursors[key];
    });
}
