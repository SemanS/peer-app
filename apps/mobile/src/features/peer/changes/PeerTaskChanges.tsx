import { View } from "react-native";
import { useMemo } from "react";

import { AppText as Text } from "../../../components/ui/AppText";
import { cn } from "../../../lib/cn";
import { useMinuteClock } from "../ownership/useMinuteClock";
import type { PeerTaskProps } from "../slotTypes";
import { CHANGES_WORDS, changesProjects, phoneTaskChanges } from "./changes.logic";
import { useChangesView } from "./useChangesView";

/**
 * The changes of the selected task, read-only: its own change and those it builds on, down to trunk.
 * Absent while no change reports the task, so a Git task keeps the page it had.
 */
export function PeerTaskChanges({
  environmentId,
  status,
  workspace,
  project,
  task,
}: PeerTaskProps) {
  const now = useMinuteClock();
  const changesProject = useMemo(
    () =>
      changesProjects(status).find(
        (candidate) =>
          candidate.workspace === workspace && candidate.projectId === project.project.id,
      ),
    [status, workspace, project.project.id],
  );
  const { view } = useChangesView({
    environmentId,
    workspace,
    project: project.project.id,
    enabled: changesProject !== undefined && status.jujutsu?.problem === undefined,
  });
  if (changesProject === undefined) return null;
  const model = phoneTaskChanges({
    status,
    project: changesProject,
    taskKey: task.key ?? task.id,
    view,
    now,
  });
  if (model.kind === "none") return null;
  return (
    <View className="gap-2">
      <Text accessibilityRole="header" className="font-t3-medium text-foreground">
        {CHANGES_WORDS.heading}
      </Text>
      {model.kind === "jj" ? (
        <View className="gap-1">
          <Text className="text-sm font-t3-medium">{model.title}</Text>
          <Text className="text-sm text-foreground-muted">{model.body}</Text>
          <Text selectable className="font-mono text-sm">
            {model.fix}
          </Text>
        </View>
      ) : (
        <>
          <View className="overflow-hidden rounded-xl border border-border bg-card">
            {model.rows.map((row, index) => (
              <View
                key={row.changeId}
                accessible
                accessibilityLabel={`${row.title}, ${row.who}, ${row.line}`}
                className={cn(
                  "min-h-14 gap-0.5 px-3 py-2.5",
                  index > 0 && "border-t border-border",
                )}
              >
                <Text selectable className="text-sm font-t3-medium">
                  {row.title}
                </Text>
                <Text selectable className="text-xs text-foreground-muted">
                  {row.who}
                </Text>
                <Text className="text-xs text-foreground-muted">
                  {row.readOnly ? `${row.line} · read-only to you` : row.line}
                </Text>
              </View>
            ))}
          </View>
          <Text className="text-sm text-foreground-muted">{CHANGES_WORDS.readOnly}</Text>
        </>
      )}
    </View>
  );
}
