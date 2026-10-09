// @effect-diagnostics globalDate:off - broker stamps adapter identity from its durable handshake, not a freshness label.
/* oxlint-disable oxc/no-this-in-exported-function -- bound broker methods. */
import type { CoordinationBroker } from "./Broker.ts";
import { metricsOf, type MetricEvent, type EventFields } from "../metricsCatalog.ts";
export const stampOf = (session: import("./sessions.ts").LocalSession) => ({
  session: session.id,
  workspace: session.workspace,
  project: session.project,
  adapter:
    session.agent === "codex"
      ? "codex_hooks"
      : session.modAt !== undefined
        ? "claude_mod"
        : "claude_hooks",
});
export function record(this: CoordinationBroker, event: string, detail: Record<string, unknown>) {
  const session =
    typeof detail.session === "string" ? this.sessions.get(detail.session) : undefined;
  const stamp = session ? stampOf(session) : {};
  this.host.log.record(
    event as MetricEvent,
    { ...metricsOf(event, detail), ...stamp } as EventFields<MetricEvent>,
    detail,
  );
}
export function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
