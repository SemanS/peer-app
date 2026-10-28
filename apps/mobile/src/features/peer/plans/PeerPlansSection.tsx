import { plansSectionEmpty, plansSectionModel } from "@t3tools/client-runtime/peer/plans-view";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../../components/ui/AppText";
import type { PeerTaskProps } from "../slotTypes";
import { PlanCards } from "./PlanCards";
import { usePlansView } from "./usePlansView";

/** The time, for "declared 12 min ago", moved on every minute. */
function useMinuteClock(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * Plans of the selected task: what its agents said they will change, use and provide, where that
 * meets other work, and the challenges agents made of what it meets, as on web. A list to read:
 * nothing in it changes a plan or opens or closes a challenge, and neither adds anything to Needs
 * you. Absent while Plans is off or the Hub does not serve it.
 */
export function PeerPlansSection({
  environmentId,
  status,
  workspace,
  project,
  task,
}: PeerTaskProps) {
  const { active, view, error, refresh } = usePlansView({
    environmentId,
    status,
    workspace,
    project: project.project.id,
    task: task.id,
  });
  const now = useMinuteClock();
  if (!active) return null;
  const model =
    view === undefined
      ? undefined
      : plansSectionModel({
          status,
          workspace,
          project: project.project.id,
          task: task.id,
          view,
          now,
        });
  return (
    <View className="gap-2">
      <Text className="font-t3-medium text-foreground">Plans</Text>
      <Text className="text-sm text-foreground-muted">
        What this task’s agents said they will change, use and provide, and where that meets other
        work. Advice only: nothing here stops an edit.
      </Text>
      {error === null ? null : (
        <View className="gap-1">
          <Text accessibilityRole="alert" className="text-destructive">
            {error}
          </Text>
          <Pressable accessibilityRole="button" onPress={refresh}>
            <Text className="text-primary">Retry</Text>
          </Pressable>
        </View>
      )}
      {model === undefined ? (
        error === null ? (
          <Text className="text-foreground-muted">Loading plans…</Text>
        ) : null
      ) : plansSectionEmpty(model) ? (
        <Text className="text-foreground-muted">No agent on this task has declared a plan.</Text>
      ) : (
        <PlanCards model={model} />
      )}
    </View>
  );
}
