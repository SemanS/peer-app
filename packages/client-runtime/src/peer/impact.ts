import {
  WS_METHODS,
  type PeerImpactRecord,
  type PeerImpactView,
  type PeerImpactStatus,
  type PeerImpactPlace,
  type PeerImpactRootState,
  type PeerPluginState,
  type EnvironmentId,
} from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";
import * as Effect from "effect/Effect";
import type * as EnvironmentRegistry from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentQueryAtomFamily } from "../state/runtime.ts";
import { request } from "../rpc/client.ts";
import { activePlugin } from "./plugins.ts";
import { agoInWords } from "./work.ts";
export function createPeerImpactAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  const list = createEnvironmentQueryAtomFamily(runtime, {
    label: "peer:impact:list",
    staleTimeMs: Infinity,
    execute: (input: PeerImpactPlace & { person: string; projectIds: ReadonlyArray<string> }) =>
      request(WS_METHODS.peerImpactList, {
        workspace: input.workspace,
        ...(input.project === undefined ? {} : { project: input.project }),
        ...(input.task === undefined ? {} : { task: input.task }),
      }).pipe(Effect.map((view) => filterImpactView(view, input.projectIds))),
  });
  return {
    peerImpactList: (target: {
      environmentId: EnvironmentId;
      person: string;
      projectIds: ReadonlyArray<string>;
      input: PeerImpactPlace;
    }) =>
      list({
        environmentId: target.environmentId,
        input: {
          ...target.input,
          person: target.person,
          projectIds: [...target.projectIds].sort(),
        },
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
/** Local manifest membership fences both cached detail and responses from an older view. */
export const impactProjectIds = (
  workspaces: ReadonlyArray<{ slug: string; projects: ReadonlyArray<{ project: { id: string } }> }>,
  workspace: string,
) =>
  workspaces
    .find((w) => w.slug === workspace)
    ?.projects.map((p) => p.project.id)
    .sort() ?? [];
export const impactPlaceAllowed = (projectIds: ReadonlyArray<string>, place: PeerImpactPlace) =>
  projectIds.length > 0 && (!place.project || projectIds.includes(place.project));
export const filterImpactView = (
  view: PeerImpactView,
  projectIds: ReadonlyArray<string>,
): PeerImpactView => ({
  records: view.records.filter((record) => projectIds.includes(record.project)),
  provided: view.provided.filter((item) => projectIds.includes(item.project)),
});
/**
 * Whether Impact's views show: its plugin is active and the environment runs it. It does not run
 * while agent coordination is off, and asking it for a list then fails, so nothing of it shows
 * (Settings alone says why).
 */
export const impactRunning = (
  status: Parameters<typeof activePlugin>[0] & { readonly impact?: PeerImpactStatus | undefined },
) => activePlugin(status, "impact") && status?.impact?.enabled !== false;
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
/**
 * Changer and caller are directional: each item can point the other way in the same pair. The
 * label is one sentence, so lists show it as it is: who changed what and how, and who uses it from
 * where.
 */
export function impactRows(record: PeerImpactRecord) {
  return record.items.map((item) => {
    const changer = record.sides.find((side) => side.session === item.changer),
      caller = record.sides.find((side) => side.session !== item.changer);
    return {
      item,
      changer,
      caller,
      label: `${changer?.label ?? "A teammate"} changed ${item.name} in ${item.path} (${impactChangeLabel(item.change)}); ${caller?.label ?? "another teammate"} uses it${item.from.length ? ` from ${item.from.map((from) => `${from.name} (${from.path})`).join(", ")}` : ""}.`,
    };
  });
}

export const impactChangeLabel = (change: PeerImpactRecord["items"][number]["change"]) =>
  change === "body" ? "body changed" : change === "signature" ? "signature changed" : "removed";
export function impactAction(record: PeerImpactRecord, operate: boolean) {
  if (!operate || !record.live || record.state === "cleared") return null;
  return record.state === "dismissed"
    ? { command: "reopen" as const, label: "Reopen" }
    : { command: "dismiss" as const, label: "Dismiss" };
}
export const visibleImpactProvided = (view: PeerImpactView | undefined, place: PeerImpactPlace) =>
  view?.provided.filter(
    (item) =>
      (!place.project || item.project === place.project) &&
      (!place.task || item.side.task === place.task),
  ) ?? [];
export function impactControl(
  status: PeerImpactStatus | undefined,
  plugin: PeerPluginState | undefined,
) {
  const locked =
    status?.forcedOff === true || plugin?.locked === true || plugin?.reason === "PEER_IMPACT=off";
  return {
    on: !locked && (status?.enabled ?? plugin?.enabled ?? false),
    locked,
    reason: locked
      ? "Turned off by PEER_IMPACT=off."
      : !plugin
        ? "This environment does not support impact overlaps."
        : plugin.reason === "hub"
          ? "This Hub does not support impact overlaps. File overlaps still work."
          : !plugin.active
            ? "Impact overlaps are inactive on this environment."
            : // It runs only while agent coordination is on: the switch reads off until then.
              status?.enabled === false
              ? "Impact overlaps wait for agent coordination, which is off on this computer."
              : "Advice from this environment’s CodeGraph indexes; never blocks an edit or wakes an idle agent.",
  };
}
export const impactRootLabel = (root: PeerImpactRootState) =>
  root.state === "pending" && root.waiting
    ? `${root.waiting} changed ${root.waiting === 1 ? "file waits" : "files wait"} for CodeGraph and ${root.waiting === 1 ? "is" : "are"} left out until the index is current.`
    : {
        ready: "CodeGraph index is ready.",
        missing: "CodeGraph is not installed on this environment.",
        uninitialized: "No CodeGraph index. Initialize this checkout yourself.",
        corrupt: "The CodeGraph index is corrupt; recover it before using impact overlaps.",
        pending: "Changed files are pending in CodeGraph; they are left out until current.",
        partial: "The CodeGraph index is partial and cannot be used.",
        mismatch: "The CodeGraph index belongs to another checkout.",
        failed: "CodeGraph could not be read. This checkout is temporarily paused.",
      }[root.state];
/** When Peer last heard from the Hub about impact overlaps, in words. */
export const impactContactLabel = (status: PeerImpactStatus | undefined, now: number) => {
  const at = status?.lastContact === undefined ? Number.NaN : Date.parse(status.lastContact);
  return Number.isFinite(at) ? `Last contact ${agoInWords(at, now)}.` : "No impact contact yet.";
};
export const impactHubLabel = (status: PeerImpactStatus | undefined) =>
  status?.hubSupport === "supported"
    ? "Hub supports impact overlaps."
    : status?.hubSupport === "unsupported"
      ? "Hub does not support impact overlaps. File overlaps still work."
      : "Hub support has not been checked yet.";
