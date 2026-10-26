import { ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type { ProjectionStoreV2 } from "../../../orchestration-v2/ProjectionStore.ts";

export const contextLineage = Effect.fn("PeerCoordination.contextLineage")(function* (
  projections: ProjectionStoreV2["Service"],
  key: string,
) {
  const id = ThreadId.make(key.replace(/^peer:/, ""));
  const records = yield* projections.getThreadRecords(id, ["contextTransfers", "providerThreads"]);
  const sources: Array<{ thread: string; cutoff: string }> = [];
  const transfers = records.contextTransfers.filter(
    (transfer) =>
      transfer.targetThreadId === id &&
      transfer.status !== "failed" &&
      transfer.status !== "superseded",
  );
  for (const transfer of transfers) {
    let cutoff = DateTime.formatIso(transfer.createdAt);
    if (
      transfer.sourcePoint.runId !== undefined ||
      transfer.sourcePoint.checkpointId !== undefined
    ) {
      const source = yield* projections.getThreadRecords(transfer.sourceThreadId, ["runs"]);
      const run = source.runs.find((run) =>
        transfer.sourcePoint.runId !== undefined
          ? run.id === transfer.sourcePoint.runId
          : run.checkpointId === transfer.sourcePoint.checkpointId,
      );
      // An unresolved historical source must never inherit the parent's later state.
      cutoff = run?.completedAt == null ? "unavailable" : DateTime.formatIso(run.completedAt);
    }
    sources.push({ thread: `peer:${transfer.sourceThreadId}`, cutoff });
  }
  const parent = records.thread.lineage.parentThreadId;
  if (parent !== null && !sources.some((source) => source.thread === `peer:${parent}`)) {
    const fork = records.thread.forkedFrom;
    let cutoff = DateTime.formatIso(records.thread.createdAt);
    if (fork?.type === "run") {
      const source = yield* projections.getThreadRecords(fork.threadId, ["runs"]);
      const run = source.runs.find((run) => run.id === fork.runId);
      cutoff = run?.completedAt == null ? "unavailable" : DateTime.formatIso(run.completedAt);
    }
    sources.push({ thread: `peer:${parent}`, cutoff });
  }
  const latest = new Map<string, { thread: string; cutoff: string }>();
  for (const source of sources) {
    const previous = latest.get(source.thread);
    if (previous === undefined || source.cutoff > previous.cutoff)
      latest.set(source.thread, source);
  }
  return {
    sources: [...latest.values()],
    required: sources.length > 0 || records.providerThreads.length > 1,
  };
});
