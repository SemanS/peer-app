// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - a Stop hook's wait and wall-clock activity.
/* oxlint-disable oxc/no-this-in-exported-function -- The broker's methods: Broker.ts lists them on each broker, and their `this` parameter lets them run on nothing else. */
/**
 * Waking idle agents with what they must answer: a Claude Code session's Stop hook waits for
 * it, an idle Codex session gets it through Codex's queue, and an agent a runtime runs (herdr's)
 * through that runtime. Everything else waits for the agent's next step.
 *
 * @module peerHub/core/broker/wake
 */
import * as NodeHttp from "node:http";

import { agentNamed } from "../coordination/edits.ts";
import type { CoordinationBroker } from "./Broker.ts";
import type { PeerBrokerPlugins } from "./host.ts";
import { messageOf } from "./log.ts";
import {
  stepNotices,
  withPluginText,
  notifyDeliveries,
  type PreparedDelivery,
} from "./pipeline.ts";
import { headerOf } from "./server.ts";
import type { LocalSession } from "./sessions.ts";

const WAIT_MS = 25 * 60 * 1000;
/**
 * herdr reads an agent's state off its screen, so a session that just stopped can still look busy
 * to it, and it refuses the wake. The rounds after that try again, this many times.
 */
const WAKE_TRIES = 6;

export interface Waiter {
  readonly session: string;
  readonly since: number;
  readonly answer: (text: string) => void;
}

export async function wait(
  this: CoordinationBroker,
  body: Record<string, unknown>,
  headers: NodeHttp.IncomingHttpHeaders,
): Promise<string> {
  const agent = agentNamed(headerOf(headers, "x-peer-agent"));
  const session = await this.sessionFor(
    agent,
    body,
    await this.paneOf(agent, body, headerOf(headers, "x-herdr-pane")),
  );
  if (session === null) return "";
  // Only a plugin's notice it must answer wakes it; everything else waits for its next step.
  const deliveries: PreparedDelivery[] = [];
  const ready = await this.wakingNews(session, await this.plugins(), deliveries);
  if (ready !== null) {
    await notifyDeliveries(deliveries, "offered", ready);
    this.record("wake", { session: session.id, text: ready, immediate: true });
    return ready;
  }
  return new Promise<string>((resolve) => {
    const waiter: Waiter = {
      session: session.id,
      since: Date.now(),
      answer: (text) => {
        clearTimeout(timer);
        resolve(text);
      },
    };
    const timer = setTimeout(
      () => {
        this.waiters.delete(waiter);
        resolve("");
      },
      headerOf(headers, "x-peer-adapter") === "mod"
        ? Math.min(
            typeof body.timeout_ms === "number" && body.timeout_ms > 0 ? body.timeout_ms : 25_000,
            25_000,
          )
        : WAIT_MS,
    );
    this.waiters.add(waiter);
    this.record("wait", { session: session.id });
  });
}

/**
 * What wakes an idle agent: the active plugins' notices it must answer. Overlaps and everything
 * else wait for its next step, since a colleague's work starts no turn on its person's capacity.
 */
export async function wakingNews(
  this: CoordinationBroker,
  session: LocalSession,
  plugins: PeerBrokerPlugins,
  deliveries?: PreparedDelivery[],
): Promise<string | null> {
  if (session.status !== "idle" || session.starting || session.answering > 0) return null;
  await this.findThread(session);
  if (await this.retireSuperseded(session)) return null;
  const step = this.pipelineStep(session, plugins, Date.now(), deliveries);
  const notices =
    plugins.active.length === 0
      ? null
      : await stepNotices(
          step,
          { session: step.session, event: "stop", remainingMs: 0 },
          { waking: true },
        );
  return withPluginText(null, notices);
}

/** Wakes idle agents that have something new to hear: one round at a time, another if asked meanwhile. */
export function wakeWaiters(this: CoordinationBroker) {
  if (this.waking !== null) {
    this.wakeAgain = true;
    return;
  }
  this.waking = this.wakeIdle()
    .catch((error: unknown) => this.record("wake.failed", { reason: messageOf(error) }))
    .finally(() => {
      this.waking = null;
      if (!this.wakeAgain) return;
      this.wakeAgain = false;
      this.wakeWaiters();
    });
}

export async function wakeIdle(this: CoordinationBroker) {
  const plugins = await this.plugins();
  await this.wakeCodex(plugins);
  await this.wakeRuntime(plugins);
  await this.wakeDormant(plugins);
  // A snapshot: answering one may let go of another meanwhile.
  for (const waiter of Array.from(this.waiters)) {
    const session = this.sessions.get(waiter.session);
    if (session === undefined) {
      this.waiters.delete(waiter);
      waiter.answer("");
      continue;
    }
    const deliveries: PreparedDelivery[] = [];
    const text = await this.wakingNews(session, plugins, deliveries);
    if (text === null) continue;
    if (!this.waiters.delete(waiter)) {
      // It went back to work meanwhile: it hears this at its next step.
      session.pending.push(
        deliveries.length === 0
          ? text
          : { text, deliveries, first: deliveries.some((ref) => ref.first) },
      );
      continue;
    }
    this.record("wake", { session: session.id, text });
    await notifyDeliveries(deliveries, "offered", text);
    waiter.answer(text);
  }
}

/** Resume an idle-released native conversation through its original app thread's admission. */
export async function wakeDormant(this: CoordinationBroker, plugins: PeerBrokerPlugins) {
  if (this.host.resumableThreads === undefined || this.host.queueNative === undefined) return;
  const targets = await this.host.resumableThreads();
  const ids = new Set(targets.map((target) => `${target.agent}:${target.nativeId}`));
  for (const [id, session] of this.dormantSessions) {
    await this.reconcileAcceptedWake(session);
    if (this.sessions.has(id) || (!ids.has(id) && !this.acceptedWakes.has(id)))
      this.dormantSessions.delete(id);
  }
  for (const target of targets) {
    const id = `${target.agent}:${target.nativeId}`;
    if (
      this.sessions.has(id) ||
      this.queueing.has(id) ||
      this.acceptedWakes.has(id) ||
      !target.thread.startsWith("peer:")
    )
      continue;
    await Promise.all(this.checkoutChanges.values());
    const cached = this.dormantSessions.get(id);
    let session =
      (cached?.bindingRevision === this.checkoutRevision ? cached : undefined) ??
      (await this.createSession(
        target.agent,
        { session_id: target.nativeId, cwd: target.cwd },
        undefined,
        "hooks",
        target.thread,
        true,
      ));
    if (session === null || this.sessions.has(id)) continue;
    if (session.task !== this.taskFor(session, plugins.runtime)) {
      this.dormantSessions.delete(id);
      session = await this.createSession(
        target.agent,
        { session_id: target.nativeId, cwd: target.cwd },
        undefined,
        "hooks",
        target.thread,
        true,
      );
      if (session === null || this.sessions.has(id)) continue;
    }
    if (
      session.task !== undefined &&
      this.host.taskDone(session.workspace, session.project, session.task)
    )
      continue;
    this.dormantSessions.set(id, session);
    // The memory must remain unchanged on disk until the update is durably admitted.
    this.queueing.add(id);
    const deliveries: PreparedDelivery[] = [];
    const pluginsBefore = new Map(
      [...session.pluginTold].map(([plugin, ids]) => [plugin, new Set(ids)]),
    );
    const source = session;
    const remember = (live: LocalSession) => {
      if (live === source) return;
      for (const [plugin, ids] of source.pluginTold) {
        const accepted = live.pluginTold.get(plugin) ?? new Set<string>();
        for (const value of ids) {
          if (!pluginsBefore.get(plugin)?.has(value)) accepted.add(value);
        }
        if (accepted.size > 0) live.pluginTold.set(plugin, accepted);
      }
    };
    let admitted = false;
    let text: string | null = null;
    try {
      if (this.checkoutChanges.size > 0 || session.bindingRevision !== this.checkoutRevision)
        continue;
      text = await this.wakingNews(session, plugins, deliveries);
      if (text === null) continue;
      if (this.checkoutChanges.size > 0 || session.bindingRevision !== this.checkoutRevision)
        continue;
      admitted = await this.host.queueNative(id, text, target.thread);
      if (admitted) {
        // A concurrent start may still be restoring memory read before this admission.
        // Keep the delta until that start installs its live session, even after the disk write.
        this.acceptedWakes.set(id, remember);
        const live = this.sessions.get(id);
        if (live !== undefined) remember(live);
        this.record("wake", { session: id, text, via: "native resume" });
        await notifyDeliveries(deliveries, "offered", text);
      } else {
        this.record("wake.failed", { session: id });
      }
    } catch (error) {
      this.record("wake.failed", { session: id, reason: messageOf(error) });
    } finally {
      this.queueing.delete(id);
      if (!admitted && text !== null) {
        this.dormantSessions.delete(id);
        await notifyDeliveries(deliveries, "dropped");
      }
    }
    if (admitted) {
      await this.saveMemories();
      if (this.sessions.has(id) && this.acceptedWakes.get(id) === remember)
        this.acceptedWakes.delete(id);
    }
  }
}

/**
 * Idle Codex agents hear what must wake them through Codex, which starts their turn: Codex has no
 * hook that waits and wakes them. Should Codex not take it, it waits for the agent's next step.
 */
export async function wakeCodex(this: CoordinationBroker, plugins: PeerBrokerPlugins) {
  for (const session of Array.from(this.sessions.values())) {
    if (
      session.agent !== "codex" ||
      session.adapter === "mcp" ||
      session.status !== "idle" ||
      (session.pane !== undefined && session.thread === undefined)
    )
      continue;
    if (this.queueing.has(session.id)) continue;
    const deliveries: PreparedDelivery[] = [];
    const text = await this.wakingNews(session, plugins, deliveries);
    if (text === null) continue;
    if (session.status !== "idle" || this.queueing.has(session.id)) {
      // It went back to work meanwhile: it hears this at its next step.
      session.pending.push(
        deliveries.length === 0
          ? text
          : { text, deliveries, first: deliveries.some((ref) => ref.first) },
      );
      continue;
    }
    this.queueing.add(session.id);
    this.record("wake", {
      session: session.id,
      text,
      via: session.thread?.startsWith("peer:") ? "peer admission" : "codex queue",
    });
    void this.host
      .queueCodex(session.id.slice(`${session.agent}:`.length), text, session.thread)
      .then(
        async (taken) => {
          this.queueing.delete(session.id);
          if (taken) {
            await notifyDeliveries(deliveries, "offered", text);
            return;
          }
          session.pending.push(
            deliveries.length === 0
              ? text
              : { text, deliveries, first: deliveries.some((ref) => ref.first) },
          );
          this.record("wake.failed", { session: session.id });
        },
        (cause: unknown) => {
          this.queueing.delete(session.id);
          session.pending.push(
            deliveries.length === 0
              ? text
              : { text, deliveries, first: deliveries.some((ref) => ref.first) },
          );
          this.record("wake.failed", { session: session.id, reason: messageOf(cause) });
        },
      );
  }
}

/** Idle agents a runtime runs (herdr's) hear what must wake them through it, which starts their turn. */
export async function wakeRuntime(this: CoordinationBroker, plugins: PeerBrokerPlugins) {
  const runtime = plugins.runtime;
  if (runtime === undefined) return;
  const local = await this.localRuntimeAgents();
  for (const session of Array.from(this.sessions.values())) {
    if (
      session.status !== "idle" ||
      session.pane === undefined ||
      session.thread !== undefined ||
      this.coordinationLevel(session.id) === "A" ||
      this.queueing.has(session.id)
    )
      continue;
    if (session.adapter === "mcp" && !local.some((agent) => agent.paneId === session.pane))
      continue;
    if ([...this.waiters].some((waiter) => waiter.session === session.id)) continue;
    const refused = this.wakesRefused.get(session.id);
    if (refused === undefined || session.pending.length === 0) {
      const deliveries: PreparedDelivery[] = [];
      const text = await this.wakingNews(session, plugins, deliveries);
      if (text === null) continue;
      session.pending.push(
        deliveries.length === 0
          ? text
          : { text, deliveries, first: deliveries.some((ref) => ref.first) },
      );
    }
    this.queueing.add(session.id);
    void this.host
      .run(
        runtime.wake(
          session.runtimeKey?.replace(/^herdr:/, "") ?? session.id,
          session.pane,
          "[Peer coordination update]",
        ),
      )
      .then(
        (outcome) => {
          this.record("runtime.wake", {
            status: outcome.status,
            session: session.id,
            reason: outcome.reason,
          });
          if (outcome.status !== "unavailable") {
            this.wakesRefused.delete(session.id);
            return;
          }
          this.queueing.delete(session.id);
          const tries = (refused ?? 0) + 1;
          if (tries < WAKE_TRIES) this.wakesRefused.set(session.id, tries);
          else this.wakesRefused.delete(session.id);
        },
        (error: unknown) => {
          this.queueing.delete(session.id);
          this.record("runtime.wake.unavailable", {
            session: session.id,
            reason: messageOf(error),
          });
        },
      );
  }
}
