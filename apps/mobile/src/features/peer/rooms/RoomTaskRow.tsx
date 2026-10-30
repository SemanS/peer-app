import { useNavigation } from "@react-navigation/native";
import { roomBadgeCount, type RoomPlace } from "@t3tools/client-runtime/peer/rooms";

import { AppText } from "../../../components/ui/AppText";
import { NavigationRow } from "../../../components/ui/NavigationRow";
import type { PeerTaskProps } from "../slotTypes";
import { roomBadgeText } from "./rooms.logic";

type RowProps = Pick<PeerTaskProps, "environmentId" | "status" | "workspace" | "project" | "task">;

const placeOf = ({ workspace, project, task }: RowProps): RoomPlace => ({
  workspace,
  project: project.project.id,
  task: task.id,
});

/** How many things in the task's room wait on this person, under the task's row. */
export function RoomTaskBadge(props: RowProps) {
  const text = roomBadgeText(props.status.rooms, placeOf(props));
  return text === null ? null : <AppText className="text-sm text-foreground">{text}</AppText>;
}

/** Opens the selected task's room. `onOpen` lets a modal close itself before the screen moves. */
export function RoomTaskRow(props: RowProps & { readonly onOpen?: () => void }) {
  const navigation = useNavigation();
  const place = placeOf(props);
  const waiting = roomBadgeCount(props.status.rooms, place);
  return (
    <NavigationRow
      title="Room"
      subtitle={
        waiting === 0
          ? "Talk with the team and your agent"
          : `${waiting} ${waiting === 1 ? "needs" : "need"} you`
      }
      onPress={() => {
        props.onOpen?.();
        navigation.navigate("Room", { environmentId: String(props.environmentId), ...place });
      }}
    />
  );
}
