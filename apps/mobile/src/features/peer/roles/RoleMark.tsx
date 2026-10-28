import { View } from "react-native";

import { AppText } from "../../../components/ui/AppText";
import { cn } from "../../../lib/cn";
import type { PeerTaskProps } from "../slotTypes";
import { TONE_DOT } from "../work/signals";
import { ToneChip } from "../work/WorkMarks";
import { taskRoleRows, type RoleChip } from "./roles.logic";

/**
 * A session's role on its agent's card: "reviewing", or "reviewing · advisory" where Peer cannot
 * stop its edits. The phone has no hover, so what the role means is read out with the label.
 */
export function RoleMark({ chip }: { readonly chip: RoleChip }) {
  return (
    <View accessible accessibilityLabel={`Role: ${chip.label}. ${chip.detail}`}>
      <ToneChip tone={chip.tone} label={chip.label} />
    </View>
  );
}

/**
 * The sessions on the selected task that have a role, with who runs them and what the role means.
 * Read-only: a role is set or cleared on a computer, by the thread's own person.
 */
export function TaskRoles({ status, workspace, project, task }: PeerTaskProps) {
  const rows = taskRoleRows(
    status,
    { workspace, project: project.project.id, task: task.id },
    project.project.members,
  );
  if (rows.length === 0) return null;
  return (
    <View className="gap-2">
      <AppText accessibilityRole="header" className="font-t3-medium text-foreground">
        Review sessions
      </AppText>
      {rows.map((row) => (
        <View
          key={row.key}
          accessible
          accessibilityLabel={`${row.who}, ${row.session}, ${row.label}. ${row.detail}`}
          className="flex-row items-start gap-2.5"
        >
          <View className={cn("mt-1.5 size-2 rounded-full", TONE_DOT[row.tone])} />
          <View className="min-w-0 flex-1 gap-1">
            <View className="flex-row flex-wrap items-center gap-1.5">
              <AppText className="text-sm font-t3-medium" numberOfLines={1}>
                {row.who} · {row.session}
              </AppText>
              <ToneChip tone={row.tone} label={row.label} />
            </View>
            <AppText className="text-xs text-foreground-muted">{row.detail}</AppText>
          </View>
        </View>
      ))}
    </View>
  );
}
