import {
  EnvironmentId,
  ThreadId,
  type PeerHubStatus,
  type PeerStaleInput,
} from "@t3tools/contracts";
import type { RelayAgentActivityState } from "@t3tools/contracts/relay";
import * as DateTime from "effect/DateTime";
import { decisionPoints } from "./decisions.ts";
import { emptyLedger, type AlertLedger, type LedgerIO } from "./ledger.ts";

export type ExternalState = { readonly id: ThreadId; readonly state: RelayAgentActivityState };
export class Publisher {
  ledger: AlertLedger = emptyLedger();
  readonly states = new Map<ThreadId, RelayAgentActivityState>();
  readonly io: LedgerIO;
  readonly send: (id: ThreadId, state: RelayAgentActivityState | null) => Promise<void>;
  readonly log: (fields: { kind: string; reason: string; count: number }) => void;
  readonly catchUp: () => Promise<void>;
  constructor(
    io: LedgerIO,
    send: Publisher["send"],
    log: Publisher["log"] = () => {},
    catchUp: () => Promise<void> = async () => {},
  ) {
    this.io = io;
    this.send = send;
    this.log = log;
    this.catchUp = catchUp;
  }
  async load() {
    this.ledger = await this.io.read();
  }
  source(): ReadonlyArray<ExternalState> {
    return [...this.states].map(([id, state]) => ({ id, state }));
  }
  async setAlerts(enabled: boolean) {
    const next = { ...this.ledger, alerts: enabled };
    await this.io.write(next);
    this.ledger = next;
  }
  /** Phase episodes own their timestamp. Restart/relink reconstructs the same device identity. */
  async reconcile(status: PeerHubStatus, refusals: ReadonlyArray<PeerStaleInput>, now: number) {
    const points = this.ledger.alerts ? decisionPoints(status, refusals, now) : [];
    const published = { ...this.ledger.published };
    // Persist new episode timestamps before enqueueing an externally visible update.
    // Keep old rows until their withdrawal is queued, so restart can still reconcile them.
    const nowIso = DateTime.formatIso(DateTime.makeUnsafe(now));
    for (const point of points) {
      const old = published[point.id];
      published[point.id] = {
        phase: point.phase,
        since: old?.phase === point.phase ? old.since : (point.since ?? nowIso),
      };
    }
    const original = this.ledger;
    const intent = { ...this.ledger, published: { ...published } };
    if (JSON.stringify(intent) !== JSON.stringify(this.ledger)) {
      await this.io.write(intent);
      this.ledger = intent;
    }
    const live = new Set(points.map((point) => point.id));
    for (const id of Object.keys(published)) {
      if (live.has(id)) continue;
      await this.send(ThreadId.make(id), null);
      delete published[id];
      this.states.delete(ThreadId.make(id));
      this.log({ kind: id.split(".")[1] ?? "unknown", reason: "withdrawn", count: 1 });
    }
    let restored = false;
    for (const point of points) {
      const old = original.published[point.id];
      const since = old?.phase === point.phase ? old.since : (point.since ?? nowIso);
      const id = ThreadId.make(point.id);
      const state: RelayAgentActivityState = {
        environmentId: EnvironmentId.make(status.environmentId),
        threadId: id,
        phase: point.phase,
        threadTitle: point.title,
        projectTitle: point.project,
        modelTitle: point.model,
        headline: point.headline,
        updatedAt: since,
        deepLink: `/threads/${encodeURIComponent(status.environmentId)}/${encodeURIComponent(id)}`,
      };
      const last = this.states.get(id);
      if (old?.phase === point.phase && last === undefined) restored = true;
      // A retained row is supplied lazily to Relay's startup catch-up; it needs no direct publish.
      if (
        (!old || old.phase !== point.phase || last !== undefined) &&
        JSON.stringify(last) !== JSON.stringify(state)
      ) {
        await this.send(id, state);
        this.log({ kind: point.kind, reason: "queued", count: 1 });
      }
      this.states.set(id, state);
      published[point.id] = { phase: point.phase, since };
    }
    const next: AlertLedger = { ...this.ledger, published };
    if (JSON.stringify(next) !== JSON.stringify(this.ledger)) {
      await this.io.write(next);
      this.ledger = next;
    }
    if (restored) await this.catchUp();
  }
}
