import {
  WS_METHODS,
  type PeerMemoryRecord,
  type PeerMemoryRecordRef,
  type PeerMemoryReceipt,
  type PeerMemoryChange,
} from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";

/** Critical retractions and conflicts remain visible until explicitly reviewed. */
export function coalesceMemoryCriticalChanges(
  previous: readonly PeerMemoryChange[],
  changes: readonly PeerMemoryChange[],
) {
  const byId = new Map(previous.map((change) => [change.id, change]));
  for (const change of changes)
    if (change.critical && (byId.get(change.id)?.version ?? 0) < change.version)
      byId.set(change.id, change);
  return [...byId.values()];
}

/** Review is independent of truth status: a Keep never substitutes for Git approval. */
export function memoryReviewReasons(
  record: PeerMemoryRecord,
  conflicts: readonly PeerMemoryRecord[],
) {
  const reasons: string[] = [];
  if (conflicts.length > 0) reasons.push("Conflicting evidence");
  if (record.evidenceMissing) reasons.push("Evidence missing");
  if (record.knowledge?.status === "kept_pending_review") reasons.push("Pending Git review");
  else if (record.knowledge?.status === "candidate") reasons.push("Knowledge candidate");
  if (record.decision?.status === "proposed") reasons.push("Decision awaiting review");
  if (
    record.kind === "relation" &&
    !record.relation?.resolved &&
    record.relation?.relation !== "contradicts"
  )
    reasons.push("Organization change");
  return reasons;
}

/** The same immutable source reached by several paths is still one source. */
export function memoryEvidenceSources(
  record: PeerMemoryRecord,
  related: readonly PeerMemoryRecord[],
) {
  const sources = [
    ...record.sourceRefs,
    ...related.filter((item) => item.kind === "evidence").flatMap((item) => item.sourceRefs),
  ];
  const bySource = new Map(
    sources.map((source) => [
      JSON.stringify(Object.entries(source).sort(([left], [right]) => left.localeCompare(right))),
      source,
    ]),
  );
  return [...bySource.values()];
}

const DELIVERY_RANK = { requested: 0, delivered: 1, acknowledged: 2, consumed: 3 } as const;

/** Evidence belongs to an exact version and runtime, never just an agent's display name. */
export function memoryDeliveryStates(
  ref: PeerMemoryRecordRef,
  receipts: readonly PeerMemoryReceipt[],
) {
  const byRuntime = new Map<string, PeerMemoryReceipt>();
  for (const receipt of receipts) {
    if (!receipt.records.some((record) => record.id === ref.id && record.version === ref.version))
      continue;
    const author = receipt.createdBy;
    const key = JSON.stringify([
      author.email,
      receipt.runtimeProjectId,
      author.environmentId,
      author.sessionId,
      author.runtimeGeneration,
    ]);
    const previous = byRuntime.get(key);
    if (
      previous === undefined ||
      DELIVERY_RANK[receipt.state] > DELIVERY_RANK[previous.state] ||
      (receipt.state === previous.state && receipt.at > previous.at)
    )
      byRuntime.set(key, receipt);
  }
  return [...byRuntime.values()].map((receipt) => ({
    ...receipt.createdBy,
    runtimeProjectId: receipt.runtimeProjectId,
    state: receipt.state,
    at: receipt.at,
    projectionId: receipt.projectionId,
    outputRef: receipt.outputRef,
  }));
}

export function setMemorySelection(
  selected: readonly PeerMemoryRecordRef[],
  ref: PeerMemoryRecordRef,
  checked: boolean,
) {
  const other = selected.filter((item) => item.id !== ref.id);
  return checked ? [...other, ref] : other;
}

export function memorySelectionChanges(
  selected: readonly PeerMemoryRecordRef[],
  records: readonly PeerMemoryRecord[],
) {
  return selected.flatMap((ref) => {
    const current = records.find((record) => record.id === ref.id);
    return current === undefined ||
      (current.version === ref.version && current.lifecycle === "active")
      ? []
      : [{ selected: ref, current }];
  });
}

export function parseMemoryReferences(input: string): PeerMemoryRecordRef[] {
  const refs: PeerMemoryRecordRef[] = [];
  for (const part of input
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean)) {
    const match = /^(\S+)@([1-9]\d*)$/.exec(part);
    if (match === null || !Number.isSafeInteger(Number(match[2])))
      throw new Error("Use id@version for each reference.");
    const id = match[1]!;
    const version = Number(match[2]);
    if (refs.some((ref) => ref.id === id && ref.version !== version))
      throw new Error("Choose one version of each record.");
    if (!refs.some((ref) => ref.id === id)) refs.push({ id, version });
  }
  return refs;
}

export function memoryKnowledgeLabel(record: PeerMemoryRecord) {
  const status = record.knowledge?.status;
  return status === "kept_pending_review"
    ? "Kept · pending Git review"
    : status === "approved"
      ? record.kind === "knowledge"
        ? "Approved knowledge"
        : "Linked Git knowledge approved"
      : status === "rejected"
        ? "Rejected knowledge"
        : status === "candidate"
          ? "Knowledge candidate"
          : null;
}

/** Peer Memory's reads and commands. Its queries are never kept: what memory says must be current. */
export function createPeerMemoryAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  return {
    peerHubMemoryState: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:peer-hub:memory-state",
      tag: WS_METHODS.peerHubMemoryState,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    peerHubMemoryQueue: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:peer-hub:memory-queue",
      tag: WS_METHODS.peerHubMemoryQueue,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    peerHubMemoryRetry: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-hub:memory-retry",
      tag: WS_METHODS.peerHubMemoryRetry,
    }),
    peerHubMemoryDiscard: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-hub:memory-discard",
      tag: WS_METHODS.peerHubMemoryDiscard,
    }),
    peerHubMemoryMode: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:peer-hub:memory-mode",
      tag: WS_METHODS.peerHubMemoryMode,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    peerHubMemorySetMode: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-hub:memory-setmode",
      tag: WS_METHODS.peerHubMemorySetMode,
    }),
    peerHubMemorySearch: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:peer-hub:memory-search",
      tag: WS_METHODS.peerHubMemorySearch,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    peerHubMemoryRead: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:peer-hub:memory-read",
      tag: WS_METHODS.peerHubMemoryRead,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    peerHubMemoryProject: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-hub:memory-project",
      tag: WS_METHODS.peerHubMemoryProject,
    }),
    peerHubMemoryExecute: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-hub:memory-execute",
      tag: WS_METHODS.peerHubMemoryExecute,
    }),
    peerHubMemoryChanges: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:peer-hub:memory-changes",
      tag: WS_METHODS.peerHubMemoryChanges,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    peerHubMemoryReceipts: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:peer-hub:memory-receipts",
      tag: WS_METHODS.peerHubMemoryReceipts,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    peerHubMemoryKeep: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-hub:memory-keep",
      tag: WS_METHODS.peerHubMemoryKeep,
    }),
    peerHubMemoryImportKnowledge: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-hub:memory-importknowledge",
      tag: WS_METHODS.peerHubMemoryImportKnowledge,
    }),
  };
}
