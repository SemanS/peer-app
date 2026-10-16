import { useState } from "react";
import { Pressable, View } from "react-native";
import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import {
  formatMetric,
  metricsUnavailable,
  metricsView,
} from "@t3tools/client-runtime/peer/metrics";
import { AppText as Text } from "../../../components/ui/AppText";
import { serverEnvironment } from "../../../state/server";
import { useEnvironmentQuery } from "../../../state/query";
import type { PeerSectionProps } from "../slotTypes";
function ProjectMetrics({
  environmentId,
  environmentLabel,
  status,
  workspace,
  project,
  name,
}: {
  environmentId: EnvironmentId;
  environmentLabel: string;
  status: PeerHubStatus;
  workspace: string;
  project: string;
  name: string;
}) {
  const [open, setOpen] = useState(false),
    [scope, setScope] = useState<"environment" | "team">("environment");
  const query = useEnvironmentQuery(
      open
        ? serverEnvironment.peerMetricsSummary({
            environmentId,
            input: { workspace, project, scope, window: 28 },
          })
        : null,
    ),
    summary = query.data,
    view = summary
      ? metricsView(summary, { coordinationEnabled: status.coordination.enabled })
      : null;
  return (
    <View className="gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
      >
        <Text className="font-t3-medium text-primary">
          {open ? "Hide metrics" : "Metrics"} · {name}
        </Text>
      </Pressable>
      {open ? (
        <View className="gap-2">
          <View className="flex-row gap-4">
            {(["environment", "team"] as const).map((s) => (
              <Pressable
                key={s}
                accessibilityRole="button"
                disabled={s === "team" && summary?.team.state !== "on"}
                accessibilityState={{
                  selected: s === scope,
                  disabled: s === "team" && summary?.team.state !== "on",
                }}
                onPress={() => setScope(s)}
              >
                <Text className="text-primary">
                  {s === "environment" ? "This environment" : "Team"}
                </Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={query.refresh}
              disabled={query.isPending}
            >
              <Text className="text-primary">Refresh</Text>
            </Pressable>
          </View>
          <Text className="text-foreground-muted">28 UTC days · {environmentLabel}</Text>
          {query.isPending && !summary ? (
            <Text className="text-foreground-muted">Reading metrics…</Text>
          ) : null}
          {query.error ? (
            <Text className="text-foreground-muted">{metricsUnavailable(query.error)}</Text>
          ) : null}
          {summary && view ? (
            <>
              <Text className="text-foreground-muted">
                {summary.scope === "team"
                  ? `Team · ${summary.current.computers ?? 0} contributing computers`
                  : "This environment"}
                . {summary.team.reason} Computed {new Date(summary.computedAt).toLocaleString()}.
                {summary.current.incomplete ? " Some Hub outcomes are incomplete." : ""}
              </Text>
              {view.cards
                .filter((c) =>
                  ["coverage", "latency", "stale", "pr", "review", "done", "task"].includes(c.id),
                )
                .map((card) => (
                  <View key={card.id} className="gap-1">
                    <Text className="text-foreground">
                      {card.title}: {formatMetric(card.value, card.unit)}
                    </Text>
                    {card.reason ? (
                      <Text className="text-foreground-muted">{card.reason}</Text>
                    ) : null}
                    <Text className="text-foreground-muted">
                      {card.definition} Source: {card.source}; covers {card.covers}.
                    </Text>
                  </View>
                ))}
              <Text className="text-foreground-muted">
                Tokens are not money; personal capacity and unavailable subagent usage are excluded.
                Controls and exports are in Settings → Peer → Coordination & plugins on web or
                desktop.
              </Text>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
export function PeerMetricsSummary({ environmentId, label, status }: PeerSectionProps) {
  return (
    <View className="gap-3">
      {status.workspaces.flatMap((w) =>
        w.projects.map((p) => (
          <ProjectMetrics
            key={`${w.slug}/${p.project.id}`}
            environmentId={environmentId}
            environmentLabel={label}
            status={status}
            workspace={w.slug}
            project={p.project.id}
            name={`${w.name} · ${p.project.name}`}
          />
        )),
      )}
    </View>
  );
}
