import {
  WS_METHODS,
  type PeerForecast,
  type PeerForecastSide,
  type PeerForecastPair,
} from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "./connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./state/runtime.ts";
import { agoInWords } from "./peer/work.ts";
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
  return seconds < 60 ? "just now" : `${Math.floor(seconds / 60)}m ago`;
};
const branches = (count: number) => `${count} ${count === 1 ? "branch" : "branches"}`;
/** A time Settings tells in words ("3 min ago"); the time as it came when it is not one. */
const agoOf = (at: string, now: number) => {
  const time = Date.parse(at);
  return Number.isFinite(time) ? agoInWords(time, now) : at;
};
/** How long until a time, in words ("in 12 min"). */
const inWords = (at: string, now: number) => {
  const minutes = Math.ceil((Date.parse(at) - now) / 60_000);
  return !Number.isFinite(minutes)
    ? at
    : minutes <= 1
      ? "in a minute"
      : minutes < 120
        ? `in ${minutes} min`
        : `in ${Math.ceil(minutes / 60)} h`;
};
/** A repository named by its folder: the clone's `.git` directory is not what people call it. */
export const forecastRepositoryName = (repository: string) =>
  repository
    .replace(/[/\\]\.git[/\\]?$/, "")
    .split(/[/\\]/)
    .findLast(Boolean) ?? repository;
export function forecastSettings(snapshot: PeerForecast | "unavailable", now: number) {
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
            `${branches(snapshot.tracked)} tracked${snapshot.checkedAt ? `, last checked ${agoOf(snapshot.checkedAt, now)}` : ""}.`,
          ];
  if (snapshot.skipped) lines.push(`${branches(snapshot.skipped)} not forecast (branch limit).`);
  if (snapshot.notOnOrigin)
    lines.push(
      `${snapshot.notOnOrigin} teammate ${snapshot.notOnOrigin === 1 ? "branch" : "branches"} not on origin.`,
    );
  for (const paused of snapshot.paused)
    lines.push(
      `${forecastRepositoryName(paused.repository)} is paused after slow checks and resumes ${inWords(paused.until, now)}.`,
    );
  if (snapshot.fetchFailedAt)
    lines.push(`Fetching named origin branches failed ${agoOf(snapshot.fetchFailedAt, now)}.`);
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
            // The tooltip names the pair and three files; the Work panel lists them all.
            const rest = pair.more + Math.max(0, pair.files.length - 3);
            rows.push(
              `${forecastPairKey(pair)}\0${pair.a.branch} ↔ ${pair.b.branch}: ${pair.files.slice(0, 3).join(", ")}${rest ? ` and ${rest} more` : ""}`,
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
