import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { PeerWorkspaces } from "../peer/PeerWorkspaces";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { SettingsScreen } from "./components/SettingsScreen";

/** The Peer workspaces route: a screen around `PeerWorkspaces`, which composes the plugins. */
export function SettingsPeerHubRouteScreen() {
  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen title="Peer workspaces" trailing={<AndroidSettingsEnvironmentFilter />}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          className="flex-1"
          contentContainerClassName="gap-5 px-5 pt-4 pb-10"
        >
          <PeerWorkspaces />
        </ScrollView>
      </SettingsScreen>
    </>
  );
}
