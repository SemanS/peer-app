import { useNavigation } from "@react-navigation/native";
import { memo, useCallback, useMemo } from "react";

import { NavigationRow } from "../../../components/ui/NavigationRow";
import { roomNeedsAcross, roomRowsAcross } from "./rooms.logic";
import { useRoomEnvironments } from "./useRoomEnvironments";

const Row = memo(function Row({ subtitle, onPress }: { subtitle: string; onPress: () => void }) {
  return <NavigationRow title="Rooms" subtitle={subtitle} onPress={onPress} />;
});

/** Opens the rooms, while a computer reports one; says how many wait on the person. */
export function HomeRoomsRow() {
  const environments = useRoomEnvironments();
  const navigation = useNavigation();
  const open = useCallback(() => navigation.navigate("Rooms"), [navigation]);
  const subtitle = useMemo(() => {
    const rooms = roomRowsAcross(environments).length;
    if (rooms === 0) return null;
    const needs = roomNeedsAcross(environments).length;
    return needs > 0
      ? `${needs} ${needs === 1 ? "needs" : "need"} you`
      : `${rooms} ${rooms === 1 ? "room" : "rooms"}`;
  }, [environments]);
  return subtitle === null ? null : <Row subtitle={subtitle} onPress={open} />;
}
