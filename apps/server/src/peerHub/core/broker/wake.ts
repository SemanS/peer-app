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
  // Findings wait for the agent's next step; only a note on an overlap wakes it, or a plugin's
  // notice it must answer.
  const deliveries: PreparedDelivery[] = [];
  const ready = await this.wakingNews(session, await this.plugins(), deliveries);
  if (ready !== null) {
    await notifyDeliveries(deliveries, "offered", ready);
    this.log("wake", { session: session.id, text: ready, immediate: true });
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
    this.log("wait", { session: session.id });
  });
}

/**
 * What wakes an idle agent: a note on one of its overlaps, then the active plugins' notices it
 * must answer. Findings and everything else wait for its next step.
 */
export async function wakingNews(
  this: CoordinationBroker,
  session: LocalSession,
  plugins: PeerBrokerPlugins,
  deliveries?: PreparedDelivery[],
): Promise<string | null> {
  if (session.status !== "idle") return null;
  const news = this.news(session, { team: false, waking: true });
  if (plugins.active.length === 0) return news;
  const step = this.pipelineStep(session, plugins, Date.now(), deliveries);
  return withPluginText(
    news,
    await stepNotices(
      step,
      { session: step.session, event: "stop", remainingMs: 0 },
      { waking: true },
    ),
  );
}

/** Wakes idle agents that have something new to hear: one round at a time, another if asked meanwhile. */
export function wakeWaiters(this: CoordinationBroker) {
  if (this.waking !== null) {
    this.wakeAgain = true;
    return;
  }
  this.waking = this.wakeIdle()
    .catch((error: unknown) => this.log("wake.failed", { reason: messageOf(error) }))
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
    this.log("wake", { session: session.id, text });
    await notifyDeliveries(deliveries, "offered", text);
    waiter.answer(text);
  }
}

/**
 * Idle Codex agents hear a note on an overlap through Codex, which starts
 * their turn: Codex has no hook that waits and wakes them. Should Codex not
 * take it, the note waits for the agent's next step.
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
    this.log("wake", {
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
          this.log("wake.failed", { session: session.id });
        },
        (cause: unknown) => {
          this.queueing.delete(session.id);
          session.pending.push(
            deliveries.length === 0
              ? text
              : { text, deliveries, first: deliveries.some((ref) => ref.first) },
          );
          this.log("wake.failed", { session: session.id, reason: messageOf(cause) });
        },
      );
  }
}

/** Idle agents a runtime runs (herdr's) hear overlap news through it, which starts their turn. */
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
    const deliveries: PreparedDelivery[] = [];
    const text = await this.wakingNews(session, plugins, deliveries);
    if (text === null) continue;
    session.pending.push(
      deliveries.length === 0
        ? text
        : { text, deliveries, first: deliveries.some((ref) => ref.first) },
    );
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
          this.log(`runtime.wake.${outcome.status}`, {
            session: session.id,
            reason: outcome.reason,
          });
          if (outcome.status === "unavailable") this.queueing.delete(session.id);
        },
        (error: unknown) => {
          this.queueing.delete(session.id);
          this.log("runtime.wake.unavailable", { session: session.id, reason: messageOf(error) });
        },
      );
  }
}
