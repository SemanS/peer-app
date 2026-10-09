import { useState } from "react";
import type { EnvironmentId, PeerWebhook } from "@t3tools/contracts";
import {
  canRequeue,
  eventLabel,
  failureSentence,
  orderDeliveries,
  webhookStatus,
  WEBHOOK_STATUS_LABELS,
  webhookActionMessage,
} from "@t3tools/client-runtime/peer/webhooks";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { useEnvironmentQuery } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import { webhookAtoms } from "./atoms";

export function WebhookRow({
  environmentId,
  workspace,
  webhook,
  onRefresh,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly webhook: PeerWebhook;
  readonly onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const deliveries = useEnvironmentQuery(
    open
      ? webhookAtoms.deliveries({
          environmentId,
          input: { workspace, id: webhook.id, state: "failed", limit: 100 },
        })
      : null,
  );
  const requeue = useAtomCommand(webhookAtoms.requeue, { reportFailure: false });
  const test = useAtomCommand(webhookAtoms.test, { reportFailure: false });
  const state = webhookStatus(webhook);
  async function act(action: "test" | "requeue", delivery?: string) {
    setBusy(true);
    setMessage(null);
    try {
      const input = {
        environmentId,
        input: { workspace, id: webhook.id, ...(delivery ? { delivery } : {}) },
      };
      const result = action === "test" ? await test(input) : await requeue(input);
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          setMessage(error instanceof Error ? error.message : String(error));
        }
      } else {
        setMessage(webhookActionMessage(result.value));
        onRefresh();
        deliveries.refresh();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{webhook.id}</span>
        <Badge variant={state === "failing" ? "error" : "outline"}>
          {WEBHOOK_STATUS_LABELS[state]}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {webhook.destination.host ?? "Destination needs setup"}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {webhook.events.map(eventLabel).join(" · ") || "No events selected"} ·{" "}
        {webhook.projects?.join(", ") ?? "All projects"}
      </p>
      <p className="mt-1 text-sm">
        {webhook.health.failed} failed · {webhook.health.pending} pending
        {webhook.health.lastDeliveredAt
          ? ` · Last delivered ${new Date(webhook.health.lastDeliveredAt).toLocaleString()}`
          : " · No successful deliveries yet"}
      </p>
      {webhook.health.lastFailure ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {failureSentence(webhook.health.lastFailure)}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Hide failures" : "Inspect failures"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !canRequeue(webhook)}
          onClick={() => void act("requeue")}
        >
          Requeue failed
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={
            busy ||
            !webhook.enabled ||
            webhook.destination.state !== "ok" ||
            webhook.signing === "missing"
          }
          onClick={() => void act("test")}
        >
          Send test
        </Button>
      </div>
      {message ? (
        <p role="status" className="mt-2 text-sm">
          {message}
        </p>
      ) : null}
      {open ? (
        <div className="mt-3 flex flex-col gap-2">
          {deliveries.error ? (
            <p role="alert" className="text-sm text-destructive">
              {deliveries.error}
            </p>
          ) : null}
          {deliveries.isPending && !deliveries.data ? (
            <p role="status" className="text-sm">
              Loading failures…
            </p>
          ) : null}
          {deliveries.data?.deliveries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No failed deliveries.</p>
          ) : null}
          {orderDeliveries(deliveries.data?.deliveries ?? []).map((delivery) => (
            <div
              key={delivery.id}
              className="flex flex-wrap items-center justify-between gap-2 border-t pt-2"
            >
              <div className="min-w-0 text-sm">
                <p>
                  {eventLabel(delivery.event)}
                  {delivery.title ? ` · ${delivery.title}` : ""}
                </p>
                <p className="text-muted-foreground">
                  {failureSentence(delivery.failure)} · {delivery.attempts} attempts
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || !canRequeue(webhook, delivery)}
                onClick={() => void act("requeue", delivery.id)}
              >
                Requeue
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
