import {
  WS_METHODS,
  type PeerWebhook,
  type PeerWebhookDelivery,
  type PeerWebhookFailure,
} from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";

/** First match wins: a paused or incomplete destination cannot be described as healthy. */
export function webhookStatus(webhook: PeerWebhook) {
  if (!webhook.enabled) return "paused";
  if (webhook.destination.state !== "ok" || webhook.signing === "missing") return "needs-setup";
  if (webhook.health.failed > 0) return "failing";
  const { pending, lastFailure, lastDeliveredAt } = webhook.health;
  if (
    pending > 0 &&
    lastFailure &&
    (!lastDeliveredAt || Date.parse(lastFailure.at) > Date.parse(lastDeliveredAt))
  )
    return "retrying";
  return "healthy";
}

export const WEBHOOK_STATUS_LABELS = {
  paused: "Paused",
  "needs-setup": "Needs setup",
  failing: "Failing",
  retrying: "Retrying",
  healthy: "Healthy",
} as const;

const EVENTS: Readonly<Record<string, string>> = {
  "overlap.ask": "Overlap needs a decision",
  "task.review": "Task ready for review",
  "task.done": "Task completed",
  "work.merged": "Work merged",
  handoff: "Agent handoff",
  "candidate.waiting": "Knowledge waiting for review",
  "request.created": "Team request sent",
  "request.answered": "Team request answered",
  "announcement.posted": "Announcement posted",
  ping: "Test notification",
};
export const eventLabel = (event: string) => EVENTS[event] ?? event;

const FAILURES: Readonly<Record<string, string>> = {
  network: "The destination could not be reached",
  connect: "The destination could not be reached",
  dns: "The destination's name could not be resolved",
  tls: "The destination's HTTPS connection failed",
  abandoned: "The delivery stopped after repeated attempts without an outcome",
  timeout: "The destination timed out",
  status: "The destination refused the delivery",
  redirect: "Redirects are not allowed",
  blocked: "The destination is not a public HTTPS address",
  config: "A destination or signing secret needs setup",
  disabled: "The webhook is paused",
  expired: "The delivery expired",
  oversized: "The destination's reply was too large",
};
export function failureSentence(failure: PeerWebhookFailure | null | undefined) {
  if (!failure) return "No delivery failure.";
  const summary = FAILURES[failure.class] ?? failure.class;
  const status = failure.status === undefined ? "" : ` (HTTP ${failure.status})`;
  const reply = failure.detail?.split(/[\r\n]/, 1)[0]?.slice(0, 160);
  return `${summary}${status}${reply ? ` · ${reply}` : ""}`;
}

const PRIORITY = { failing: 0, "needs-setup": 1, retrying: 2, healthy: 3, paused: 4 } as const;
export const orderWebhooks = (rows: ReadonlyArray<PeerWebhook>) =>
  [...rows].sort(
    (a, b) => PRIORITY[webhookStatus(a)] - PRIORITY[webhookStatus(b)] || a.id.localeCompare(b.id),
  );
export const orderDeliveries = (rows: ReadonlyArray<PeerWebhookDelivery>) =>
  [...rows].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id),
  );

export const administeredWorkspaces = <T extends { readonly role: string }>(status: {
  readonly workspaces: ReadonlyArray<T>;
}) => status.workspaces.filter(({ role }) => role === "owner" || role === "admin");
export const canRequeue = (webhook: PeerWebhook, delivery?: { readonly state: string }) =>
  webhook.enabled &&
  webhook.destination.state === "ok" &&
  webhook.signing !== "missing" &&
  (delivery === undefined ? webhook.health.failed > 0 : delivery.state === "failed");

/** Opened queries and explicit actions only; no timer or polling. */
export function createWebhooksEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:peer:webhooks:list",
      tag: WS_METHODS.peerWebhooksList,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    deliveries: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:peer:webhooks:deliveries",
      tag: WS_METHODS.peerWebhooksDeliveries,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    requeue: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer:webhooks:requeue",
      tag: WS_METHODS.peerWebhooksRequeue,
    }),
    test: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer:webhooks:test",
      tag: WS_METHODS.peerWebhooksTest,
    }),
  };
}

/** The action was queued; this does not claim that the destination received it. */
export function webhookActionMessage(
  result: { readonly requeued: number } | { readonly delivery: string },
) {
  if ("delivery" in result) return "Test queued. Refresh to check delivery.";
  return `${result.requeued} ${result.requeued === 1 ? "delivery" : "deliveries"} requeued. Refresh to check delivery.`;
}
