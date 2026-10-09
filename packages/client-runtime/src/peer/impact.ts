import {
  WS_METHODS,
  type PeerImpactRecord,
  type PeerImpactView,
  type PeerImpactStatus,
  type PeerImpactPlace,
} from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";
import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";
export function createPeerImpactAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  return {
    peerImpactList: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "peer:impact:list",
      tag: WS_METHODS.peerImpactList,
      staleTimeMs: Infinity,
    }),
    peerImpactDismiss: createEnvironmentRpcCommand(runtime, {
      label: "peer:impact:dismiss",
      tag: WS_METHODS.peerImpactDismiss,
    }),
    peerImpactReopen: createEnvironmentRpcCommand(runtime, {
      label: "peer:impact:reopen",
      tag: WS_METHODS.peerImpactReopen,
    }),
    peerImpactConfigure: createEnvironmentRpcCommand(runtime, {
      label: "peer:impact:configure",
      tag: WS_METHODS.peerImpactConfigure,
    }),
  };
}
export const impactCount = (status: PeerImpactStatus | undefined, place: PeerImpactPlace) =>
  status?.counts
    .filter(
      (row) =>
        row.workspace === place.workspace &&
        (!place.project || row.project === place.project) &&
        (!place.task || row.task === place.task),
    )
    .reduce((n, row) => n + row.count, 0) ?? 0;
export const visibleImpactRecords = (view: PeerImpactView | undefined, place: PeerImpactPlace) =>
  view?.records.filter(
    (record) =>
      record.live &&
      record.state !== "cleared" &&
      (!place.project || record.project === place.project) &&
      (!place.task || record.sides.some((side) => side.task === place.task)),
  ) ?? [];
/** Changer and caller are directional: each item can point the other way in the same pair. */
export function impactRows(record: PeerImpactRecord) {
  return record.items.map((item) => {
    const changer = record.sides.find((side) => side.session === item.changer),
      caller = record.sides.find((side) => side.session !== item.changer);
    return {
      item,
      changer,
      caller,
      label: `${changer?.label ?? "A teammate"} changed ${item.name} in ${item.path}; ${caller?.label ?? "another teammate"} uses it${item.from.length ? ` from ${item.from.map((from) => from.name).join(", ")}` : ""}.`,
    };
  });
}
