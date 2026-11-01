import { useNavigation } from "@react-navigation/native";
import { useMemo } from "react";
import { Platform } from "react-native";

import { AppText } from "../../../components/ui/AppText";
import { NavigationRow } from "../../../components/ui/NavigationRow";
import { ScreenScrollView } from "../../../components/ui/ScreenScrollView";
import { NativeStackScreenOptions } from "../../../native/StackHeader";
import { SettingsScreen } from "../../settings/components/SettingsScreen";
import { RoomNeedsYouCard } from "./RoomNeedsYouCard";
import { roomNeedGroups, roomNeedsAcross, roomRowLine, roomRowsAcross } from "./rooms.logic";
import { useRoomEnvironments } from "./useRoomEnvironments";

const TITLE = "Rooms";

/** Every room the person can see, over every computer: what waits on them, then the rest. */
export function RoomsRouteScreen() {
  const environments = useRoomEnvironments();
  const navigation = useNavigation();
  const needs = useMemo(() => roomNeedGroups(roomNeedsAcross(environments)), [environments]);
  const rows = useMemo(() => roomRowsAcross(environments), [environments]);
  return (
    <>
      <NativeStackScreenOptions
        options={{ title: TITLE, ...(Platform.OS === "android" ? { headerShown: false } : {}) }}
      />
      <SettingsScreen title={TITLE}>
        <ScreenScrollView
          contentInsetAdjustmentBehavior="automatic"
          className="flex-1"
          contentContainerClassName="gap-4 px-5 pt-4 pb-8"
          keyboardShouldPersistTaps="handled"
        >
          {needs.map((group) => (
            <RoomNeedsYouCard key={group.key} items={group.items} />
          ))}
          {rows.length === 0 ? (
            <AppText className="text-sm text-foreground-muted">
              No room has anything yet. Start a task in Peer on web or desktop.
            </AppText>
          ) : (
            rows.map((row) => (
              <NavigationRow
                key={row.key}
                title={row.title}
                subtitle={roomRowLine(row)}
                onPress={() =>
                  navigation.navigate("Room", {
                    environmentId: String(row.environmentId),
                    workspace: row.workspace,
                    project: row.project,
                    task: row.task,
                  })
                }
              />
            ))
          )}
        </ScreenScrollView>
      </SettingsScreen>
    </>
  );
}
