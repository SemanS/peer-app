import {
  acceptanceRevision,
  personName,
  taskAcceptance,
} from "@t3tools/client-runtime/peer/acceptance";
import { View } from "react-native";

import { AppText } from "../../../components/ui/AppText";
import { cn } from "../../../lib/cn";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import type { PeerTaskProps } from "../slotTypes";
import { sectionView } from "./acceptance.logic";

/**
 * The selected task's acceptance, read-only: who accepted it, when and their note, with every
 * acceptance and withdrawal, or "Done · not accepted". Read again whenever the status says it
 * changed.
 */
export function AcceptanceSection({
  environmentId,
  status,
  workspace,
  project,
  task,
}: PeerTaskProps) {
  const place = { workspace, project: project.project.id, task: task.id };
  const summary = taskAcceptance(status, place);
  const query = useEnvironmentQuery(
    serverEnvironment.peerAcceptanceView({
      environmentId,
      input: place,
      revision: acceptanceRevision(status, place),
    }),
  );
  const view = sectionView(summary, query.data, task.status ?? "open", (email) =>
    personName(status, workspace, email),
  );
  if (view === null) return null;
  return (
    <View className="gap-2">
      <AppText accessibilityRole="header" className="font-t3-medium text-foreground">
        Acceptance
      </AppText>
      <AppText
        className={cn(
          "text-sm",
          view.accepted ? "font-t3-medium text-success-foreground" : "text-foreground",
        )}
      >
        {view.heading}
      </AppText>
      {view.note === undefined ? null : (
        <AppText className="text-sm text-foreground">{view.note}</AppText>
      )}
      {view.history.map((row) => (
        <View key={row.key} className="gap-0.5 border-t border-border pt-1.5">
          <AppText className="text-xs text-foreground-muted">{row.line}</AppText>
          {row.note === undefined ? null : (
            <AppText className="text-sm text-foreground">{row.note}</AppText>
          )}
        </View>
      ))}
      {query.error === null ? null : (
        <AppText accessibilityRole="alert" className="text-sm text-destructive">
          {query.error}
        </AppText>
      )}
    </View>
  );
}
