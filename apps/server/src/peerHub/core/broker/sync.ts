// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - command ids, debounced syncs and wall-clock deadlines.
/* oxlint-disable oxc/no-this-in-exported-function -- The broker's methods: Broker.ts lists them on each broker, and their `this` parameter lets them run on nothing else. */
/**
 * Syncing with the Hub: this computer's sessions reported to each workspace, with what the
 * active plugins add, and the view read back, then shared contexts and the board followed;
 * debounced while agents work. A command to the Hub carries an op, so a retry counts once.
 *
 * @module peerHub/core/broker/sync
 */
import * as NodeCrypto from "node:crypto";

import { scopeOf } from "../../coordination.ts";
import { runtimeStillPresent } from "../../workLifecycle.ts";
import type { HubOverlap, ReportedSession } from "../hub/hubApi.ts";
import type { CoordinationBroker } from "./Broker.ts";
import { NO_PLUGINS, type PeerBrokerPlugins } from "./host.ts";
import { messageOf } from "./log.ts";

const ACTIVE_SYNC_MS = 3000;
const IDLE_SYNC_MS = 20_000;
const DEBOUNCE_MS = 300;

export const sleepMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const TIMED_OUT = Symbol("timed out");

/** What `promise` gives, or `TIMED_OUT` when it does not settle within `ms`; what it does later is nobody's concern. */
export async function within<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  // A failure that comes after the deadline must not surface as an unhandled rejection.
  promise.catch(() => undefined);
  try {
    return await Promise.race([promise, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** Names one command to the hub, so that repeating it (a retry) has no further effect. */
export const newOp = () => NodeCrypto.randomBytes(12).toString("hex");

/** What the active plugins contribute now; none, should the host fail to say. */
export function plugins(this: CoordinationBroker): Promise<PeerBrokerPlugins> {
  return this.host.plugins().catch((error: unknown) => {
    this.log("plugin.failed", { hook: "plugins", reason: messageOf(error) });
    return NO_PLUGINS;
  });
}

export function reportFor(
  this: CoordinationBroker,
  workspace: string,
): ReadonlyArray<ReportedSession> {
  return [...this.sessions.values()]
    .filter((s) => s.workspace === workspace)
    .map((s) => ({
      id: s.id,
      runtimeGeneration: s.runtimeGeneration,
      project: s.project,
      label: s.label,
      agent: s.agent,
      ...(s.branch === undefined ? {} : { branch: s.branch }),
      status: s.status,
      ...(s.intent === undefined ? {} : { intent: s.intent }),
      ...(s.task === undefined ? {} : { task: s.task }),
      files: s.files,
      claims: s.claims,
      // Its own lines, and those it marked [project] in a shared context it kept: a keeper that
      // takes over does not say again what its predecessor marked.
      findings: [...new Set([...s.team, ...s.marked])],
      // When it was last at work: an idle keeper gives way to an agent that works.
      activeAt: new Date(s.lastActivity).toISOString(),
      // What it has heard is no independent discovery when it says the same.
      heard: [...s.heard].slice(-300),
    }));
}

/** Reports a workspace's sessions with what the active plugins add to them, in registry order. */
export async function report(
  this: CoordinationBroker,
  plugins: PeerBrokerPlugins,
  workspace: string,
  sessions: ReadonlyArray<ReportedSession>,
) {
  let reported = sessions;
  for (const { plugin, add } of plugins.reportSessions) {
    const before = reported;
    reported = await this.host.run(add(workspace, before)).catch((error: unknown) => {
      this.log("plugin.failed", { plugin, hook: "reportSessions", reason: messageOf(error) });
      return before;
    });
  }
  return this.host.report(workspace, reported);
}

/** Reports and refreshes now (one workspace, or all), waiting at most `budgetMs`. */
export async function syncNow(
  this: CoordinationBroker,
  workspace?: string,
  budgetMs = 5000,
): Promise<void> {
  const run = this.sync(workspace);
  await Promise.race([run, new Promise((resolve) => setTimeout(resolve, budgetMs))]);
}

export function sync(this: CoordinationBroker, only?: string): Promise<void> {
  if (this.syncing !== null) return this.syncing.then(() => this.sync(only));
  const run = (async () => {
    const started = Date.now();
    this.dirtySince = null;
    this.lastSync = started;
    const plugins = await this.plugins();
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      const runtime = this.runtimeOf(plugins.runtime, session);
      if (
        !runtimeStillPresent({
          runtime,
          lastActivity: session.lastActivity,
          lastPresent: session.lastPresent ?? session.startedAt,
          now,
        })
      ) {
        void this.release(session);
        this.sessions.delete(id);
        this.log("session.expired", { session: id });
        continue;
      }
      // Presence is not activity: an idle runtime must not refresh the keeper's activity clock.
      if (runtime !== undefined && runtime !== null) {
        session.status = runtime === "done" ? "idle" : runtime;
        session.lastPresent = now;
      }
      await this.findThread(session);
      // Put on another task (or taken off one): its work, and the shared context with it, change.
      const task = this.taskFor(session, plugins.runtime);
      if (task !== session.task) {
        await this.release(session);
        this.log("session.task", { session: id, from: session.task, to: task });
        const from = session.task;
        session.task = task;
        session.sharedHeard = 0;
        session.sharedHeardText = "";
        // What belonged to its old work is no part of the new: lines it marked for the project,
        // the contexts it read for it, whom the roster was kept for.
        session.marked.clear();
        session.read.clear();
        session.toldClosed = false;
        session.sharedToldAt = 0;
        session.roster = undefined;
        session.compactedAt = 0;
        const name = (t: string | undefined) =>
          t === undefined ? "no task" : this.host.taskName(session.workspace, session.project, t);
        session.pending.push(
          `Peer: your person put you on ${name(task)} (you were on ${name(from)}). Its shared context is ${this.cli} context${task === undefined ? "" : ` ${this.handleOf(session.workspace, session.project, scopeOf(task))}`}; your working context stays ${session.ownContextPath}.`,
        );
      }
    }
    const workspaces = new Set<string>([
      ...this.host.workspaces(),
      ...[...this.sessions.values()].map((s) => s.workspace),
      ...this.reported,
    ]);
    for (const workspace of workspaces) {
      if (only !== undefined && workspace !== only) continue;
      const sessions = this.reportFor(workspace);
      try {
        const view =
          sessions.length > 0 || this.reported.has(workspace)
            ? await this.report(plugins, workspace, sessions)
            : await this.host.view(workspace);
        if (sessions.length > 0) this.reported.add(workspace);
        else this.reported.delete(workspace);
        this.reportedSessions.set(workspace, new Set(sessions.map((s) => s.id)));
        this.views.set(workspace, view);
        this.viewAt.set(workspace, Date.now());
        this.log("sync", {
          workspace,
          reported: sessions.map((s) => ({
            id: s.id,
            files: s.files.length,
            claims: s.claims,
            status: s.status,
          })),
          sessions: view.sessions.length,
          overlaps: view.overlaps.map((o) => ({
            id: o.id,
            state: o.state,
            files: o.files,
            notes: o.notes.length,
          })),
          ms: Date.now() - started,
        });
        this.afterViewChange(workspace);
        await this.followShared(workspace);
        await this.mirrorBoard(workspace);
      } catch (error) {
        this.log("sync.failed", {
          workspace,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  })();
  this.syncing = run.finally(() => {
    this.syncing = null;
  });
  return this.syncing;
}

export function tick(this: CoordinationBroker) {
  const now = Date.now();
  const active = [...this.sessions.values()].some((s) => now - s.lastActivity < 10 * 60 * 1000);
  const due =
    (this.dirtySince !== null && now - this.dirtySince >= DEBOUNCE_MS) ||
    now - this.lastSync >= (active ? ACTIVE_SYNC_MS : IDLE_SYNC_MS);
  if (due && this.syncing === null) void this.sync();
}

export function applyOverlap(this: CoordinationBroker, workspace: string, overlap: HubOverlap) {
  const view = this.views.get(workspace);
  if (view === undefined) return;
  this.views.set(workspace, {
    ...view,
    overlaps: [...view.overlaps.filter((o) => o.id !== overlap.id), overlap],
  });
  this.afterViewChange(workspace);
}

export function afterViewChange(this: CoordinationBroker, workspace: string) {
  const view = this.views.get(workspace);
  for (const overlap of view?.overlaps ?? []) {
    if (overlap.state !== "open" || this.announcedToPeople.has(overlap.id)) continue;
    const local = overlap.sessions.filter((id) => this.sessions.has(id));
    if (local.length === 0) continue;
    this.announcedToPeople.add(overlap.id);
    const others = new Set(overlap.sessions.filter((id) => !this.sessions.has(id)));
    const other = view?.sessions.find((s) => others.has(s.id));
    const who =
      other === undefined
        ? "another agent of yours"
        : `${this.host.nameOf(workspace, other.email)}'s agent`;
    void this.notifyPeople(
      `Peer: overlap with ${who}`,
      `${overlap.files.join(", ")} · ${overlap.project}`,
    );
    this.log("overlap.opened", {
      workspace,
      overlap: overlap.id,
      sessions: overlap.sessions,
      files: overlap.files,
    });
  }
  for (const listener of this.viewListeners) listener(workspace);
  this.wakeWaiters();
  this.host.changed();
}

/** Shows people on this computer a notification where their agents run (herdr's), if it can. */
export async function notifyPeople(this: CoordinationBroker, title: string, body: string) {
  const notify = (await this.plugins()).runtime?.notify;
  if (notify !== undefined) void this.host.run(notify(title, body)).catch(() => undefined);
}
