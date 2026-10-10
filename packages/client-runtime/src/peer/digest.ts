import {
  WS_METHODS,
  digestPhrase,
  type PeerDigestEntry,
  type PeerDigestSection,
  type PeerDigest,
  type PeerDigestInput,
  type EnvironmentId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { Atom } from "effect/unstable/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentQueryAtomFamily } from "../state/runtime.ts";
import { request } from "../rpc/client.ts";
export const AWAY_AFTER_MS = 60 * 60_000,
  HEARTBEAT_MS = 5 * 60_000;
const timestamp = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
export const VisitRecord = Schema.Struct({
  lastActiveAt: timestamp,
  away: Schema.optional(
    Schema.Struct({
      since: timestamp,
      dismissed: Schema.Array(Schema.String),
      durationSeconds: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
    }),
  ),
});
export type VisitRecord = typeof VisitRecord.Type;
export function advanceVisit(visit: VisitRecord | null, now: number): VisitRecord {
  const at = Math.max(visit?.lastActiveAt ?? 0, now);
  if (!visit) return { lastActiveAt: at };
  if (at - visit.lastActiveAt > AWAY_AFTER_MS)
    return {
      lastActiveAt: at,
      away: {
        since: visit.lastActiveAt,
        dismissed: [],
        durationSeconds: Math.floor((at - visit.lastActiveAt) / 1000),
      },
    };
  const away =
    visit.away && visit.away.durationSeconds === undefined
      ? { ...visit.away, durationSeconds: Math.max(0, Math.floor((at - visit.away.since) / 1000)) }
      : visit.away;
  return at === visit.lastActiveAt && away === visit.away
    ? visit
    : { ...visit, lastActiveAt: at, ...(away ? { away } : {}) };
}
export const projectVisitKey = (workspace: string, project: string) =>
  `${workspace.length}:${workspace}${project}`;
export function dismissAway(visit: VisitRecord, project: string): VisitRecord {
  return !visit.away || visit.away.dismissed.includes(project)
    ? visit
    : { ...visit, away: { ...visit.away, dismissed: [...visit.away.dismissed, project] } };
}
export type DigestWindow = "away" | "8h" | "24h" | "7d";
/** One automatic ask per absence; only durations cross the wire to the Hub's clock. */
export const automaticSinceFor = (visit: VisitRecord | null): string | null =>
  visit?.away
    ? `${visit.away.durationSeconds ?? Math.max(0, Math.floor((visit.lastActiveAt - visit.away.since) / 1000))}s`
    : null;
export function sinceFor(
  visit: VisitRecord | null,
  choice: DigestWindow,
  now: number,
): string | null {
  return choice === "away"
    ? visit?.away
      ? `${Math.max(0, Math.floor((now - visit.away.since) / 1000))}s`
      : null
    : choice;
}
export const windowLabel = (choice: DigestWindow) =>
  choice === "away"
    ? "Since you were away"
    : choice === "8h"
      ? "Last 8 hours"
      : choice === "24h"
        ? "Last 24 hours"
        : "Last 7 days";
export const previewEntries = (section: PeerDigestSection, limit = 3) => ({
  entries: section.entries.slice(0, limit),
  remaining: Math.max(0, section.total - Math.min(section.entries.length, limit)),
});
export const coverageNotice = (coverage: PeerDigest["coverage"]) =>
  coverage.complete
    ? null
    : `History is incomplete${coverage.from ? `; covered from ${coverage.from}` : ""}.`;
export const entryText = (entry: PeerDigestEntry, whoOf: (email: string) => string) =>
  `${entry.subject} ${digestPhrase(entry.kind)}${entry.by.length ? ` ${entry.by.slice(0, 3).map(whoOf).join(", ")}` : ""}${entry.detail ? ` · ${entry.detail}` : ""}`;
export function navigationTarget(ref: PeerDigestEntry["ref"]) {
  if (!ref) return null;
  if (ref.type === "pr")
    return /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(
      ref.id,
    )
      ? { kind: "url" as const, url: ref.id }
      : null;
  if (ref.type === "task") return { kind: "context" as const, scope: `task:${ref.id}` };
  if (ref.type === "context") return { kind: "context" as const, scope: ref.id };
  if (ref.type === "knowledge") return { kind: "knowledge" as const };
  return null;
}
const decode = Schema.decodeUnknownOption(Schema.fromJsonString(VisitRecord));
const encode = Schema.encodeSync(Schema.fromJsonString(VisitRecord));
export function decodeVisit(raw: string | null): VisitRecord | null {
  if (raw === null) return null;
  const decoded = decode(raw);
  return decoded._tag === "Some" ? decoded.value : null;
}
export function createVisitStore(storage: {
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
}) {
  return {
    read: (email: string) => {
      try {
        return decodeVisit(storage.read(email));
      } catch {
        return null;
      }
    },
    write: (email: string, visit: VisitRecord) => {
      const value = encode(visit);
      try {
        if (storage.read(email) !== value) storage.write(email, value);
      } catch {
        /* the in-memory window still works on a device denying storage */
      }
    },
  };
}
export const digestRows = (digest: PeerDigest, who: (email: string) => string) =>
  digest.sections.map((s) => ({
    ...s,
    ...previewEntries(s),
    rows: previewEntries(s).entries.map((e, i) => ({
      key: `${s.id}:${i}`,
      text: entryText(e, who),
      at: e.at,
      note: e.note,
      target: navigationTarget(e.ref),
    })),
  }));
/** One entry of a digest on the History timeline: what it is about, then what happened and who. */
export interface DigestTimelineRow {
  readonly key: string;
  readonly section: string;
  readonly at: string;
  readonly subject: string;
  readonly line: string;
  readonly note: string | undefined;
  readonly target: ReturnType<typeof navigationTarget>;
}
/** A digest's entries as one timeline, newest first: every section's, or one section's. */
export function digestTimeline(
  digest: PeerDigest,
  who: (email: string) => string,
  section: string | null = null,
): ReadonlyArray<DigestTimelineRow> {
  return digest.sections
    .filter((s) => section === null || s.id === section)
    .flatMap((s) =>
      s.entries.map((entry, i) => ({
        key: `${s.id}:${i}`,
        section: s.id,
        at: entry.at,
        subject: entry.subject,
        line: `${digestPhrase(entry.kind)}${entry.by.length ? ` ${entry.by.slice(0, 3).map(who).join(", ")}` : ""}${entry.detail ? ` · ${entry.detail}` : ""}`,
        note: entry.note,
        target: navigationTarget(entry.ref),
      })),
    )
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.key.localeCompare(b.key));
}
/** How many entries of those sections the digest counts but did not send. */
export const digestUnshown = (digest: PeerDigest, section: string | null = null) =>
  digest.sections
    .filter((s) => section === null || s.id === section)
    .reduce((sum, s) => sum + Math.max(0, s.total - s.entries.length), 0);
export function createDigestEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const get = createEnvironmentQueryAtomFamily(runtime, {
    label: "environment-data:peer.digest.get",
    staleTimeMs: 300_000,
    idleTtlMs: 60_000,
    execute: (input: PeerDigestInput & { person: string; revision?: number }) =>
      request(WS_METHODS.peerDigestGet, {
        workspace: input.workspace,
        project: input.project,
        since: input.since,
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      }),
  });
  return {
    get: (target: {
      environmentId: EnvironmentId;
      person: string;
      input: PeerDigestInput & { revision?: number };
    }) =>
      get({
        environmentId: target.environmentId,
        input: { ...target.input, person: target.person },
      }),
  };
}
/** Activity updates stay outside React; only a new away window or dismissal wakes views. */
export function createActivityVisits(
  storage: {
    read: (email: string) => VisitRecord | null;
    write: (email: string, visit: VisitRecord) => void;
  },
  persistEveryMs = 0,
) {
  const cache = new Map<string, VisitRecord | null>(),
    active = new Map<string, number>(),
    savedAt = new Map<string, number>(),
    listeners = new Set<() => void>();
  const get = (email: string) => {
    if (!cache.has(email)) cache.set(email, storage.read(email));
    return cache.get(email) ?? null;
  };
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const advance = (email: string, now: number, force = false) => {
    const before = get(email),
      next = advanceVisit(before, now);
    cache.set(email, next);
    if (
      (next !== before || force) &&
      (force || now - (savedAt.get(email) ?? -Infinity) >= persistEveryMs)
    ) {
      storage.write(email, next);
      savedAt.set(email, now);
    }
    return before?.away !== next.away;
  };
  const signal = (now: number, force = false) => {
    for (const email of active.keys()) if (advance(email, now, force)) emit();
  };
  return {
    get,
    signal,
    activate: (email: string, now: number) => {
      const cached = cache.get(email);
      if (!cache.get(email)) cache.delete(email);
      const hydrated = get(email);
      if (!active.has(email) && hydrated?.away) {
        const durationSeconds = Math.max(
          0,
          Math.floor((Math.max(now, hydrated.lastActiveAt) - hydrated.away.since) / 1000),
        );
        if (durationSeconds !== hydrated.away.durationSeconds)
          cache.set(email, { ...hydrated, away: { ...hydrated.away, durationSeconds } });
      }
      active.set(email, (active.get(email) ?? 0) + 1);
      advance(email, now);
      if (cached?.away !== get(email)?.away) emit();
      return () => {
        const n = (active.get(email) ?? 1) - 1;
        if (n <= 0) active.delete(email);
        else active.set(email, n);
      };
    },
    dismiss: (email: string, project: string) => {
      const before = get(email);
      if (!before) return;
      const next = dismissAway(before, project);
      if (next === before) return;
      cache.set(email, next);
      storage.write(email, next);
      emit();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
