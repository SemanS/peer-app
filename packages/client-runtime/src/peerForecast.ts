import {
  WS_METHODS,
  type PeerForecast,
  type PeerForecastSide,
  type PeerForecastPair,
} from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";
import type { EnvironmentRegistry } from "./connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./state/runtime.ts";
export function createPeerForecastAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    peerForecastLive: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "peer:forecast:live",
      tag: WS_METHODS.peerForecastSubscribe,
    }),
    peerForecastConfigure: createEnvironmentRpcCommand(runtime, {
      label: "peer:forecast:configure",
      tag: WS_METHODS.peerForecastConfigure,
    }),
  };
}
export function forecastAvailable(query: {
  readonly data?: PeerForecast | null | undefined;
  readonly error?: unknown;
}): PeerForecast | "unavailable" {
  return query.error != null || query.data == null ? "unavailable" : query.data;
}
export const forecastSide = (side: PeerForecastSide, me: string | null) =>
  `${side.email === me ? "you" : side.email} · ${side.title || side.branch} · ${side.branch} (${side.where})`;
export const forecastPairKey = (pair: PeerForecastPair) =>
  [pair.workspace, pair.project, pair.repository, ...[pair.a.branch, pair.b.branch].sort()].join(
    "/",
  );
export const forecastAge = (checkedAt: string, now: number) => {
  const seconds = Math.max(0, Math.floor((now - Date.parse(checkedAt)) / 1000));
  return seconds < 60 ? "just checked" : `${Math.floor(seconds / 60)}m ago`;
};
export function forecastSettings(snapshot: PeerForecast | "unavailable") {
  if (snapshot === "unavailable") return ["Merge forecast is unavailable on this environment."];
  const lines =
    snapshot.state === "off"
      ? [
          snapshot.reason === "environment"
            ? "Off because PEER_FORECAST=off."
            : "Merge forecast is off.",
        ]
      : snapshot.state === "unsupported"
        ? [
            snapshot.reason === "git-old"
              ? `Requires Git 2.38 or newer; found ${snapshot.git ?? "an older version"}.`
              : snapshot.reason === "git-missing"
                ? "Git is not installed."
                : "Could not read the Git version.",
          ]
        : [
            `On${snapshot.git ? ` · Git ${snapshot.git}` : ""}.`,
            `${snapshot.tracked} branches tracked.`,
          ];
  if (snapshot.skipped) lines.push(`${snapshot.skipped} branches not forecast (branch limit).`);
  if (snapshot.notOnOrigin) lines.push(`${snapshot.notOnOrigin} teammate branches not on origin.`);
  for (const paused of snapshot.paused)
    lines.push(`A repository is paused until ${paused.until} after slow checks.`);
  if (snapshot.fetchFailedAt)
    lines.push(`Fetching named origin branches failed at ${snapshot.fetchFailedAt}.`);
  return lines;
}
export function forecastSections(snapshot: PeerForecast | "unavailable") {
  if (snapshot === "unavailable" || snapshot.state !== "on") return [];
  const groups = new Map<string, PeerForecastPair[]>();
  for (const pair of snapshot.pairs) {
    const key = `${pair.workspace}/${pair.project}`,
      rows = groups.get(key) ?? [];
    rows.push(pair);
    groups.set(key, rows);
  }
  return [...groups].map(([project, pairs]) => ({
    project: groups.size > 1 ? project : null,
    pairs,
  }));
}
export type TaskForecast = { readonly count: number; readonly lines: ReadonlyArray<string> };
/** Entries retain their identity when a different task's prediction changes. */
export function createForecastTaskSelector() {
  let previous = new Map<string, TaskForecast>();
  return (snapshot: PeerForecast | "unavailable") => {
    const lines = new Map<string, string[]>();
    if (snapshot !== "unavailable" && snapshot.state === "on")
      for (const pair of snapshot.pairs) {
        for (const side of [pair.a, pair.b])
          if (side.task !== undefined) {
            const id = `${pair.workspace}/${pair.project}/${side.task}`,
              rows = lines.get(id) ?? [];
            if (rows.some((line) => line.startsWith(forecastPairKey(pair) + "\0"))) continue;
            rows.push(
              `${forecastPairKey(pair)}\0${pair.a.branch} ↔ ${pair.b.branch}: ${pair.files.join(", ")}${pair.more ? ` and ${pair.more} more` : ""}`,
            );
            lines.set(id, rows);
          }
      }
    const next = new Map<string, TaskForecast>();
    for (const [id, rows] of lines) {
      const value = { count: rows.length, lines: rows.map((line) => line.split("\0")[1]!) },
        old = previous.get(id);
      next.set(
        id,
        old !== undefined && JSON.stringify(old) === JSON.stringify(value) ? old : value,
      );
    }
    previous = next;
    return next;
  };
}
