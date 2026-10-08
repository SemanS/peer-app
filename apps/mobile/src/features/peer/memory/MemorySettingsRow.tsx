import { PEER_MEMORY_AVAILABLE } from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";

import { SettingsRow } from "../../settings/components/SettingsRow";

/** The Settings row that opens Memory; it shows only while the build includes memory. */
export function MemorySettingsRow() {
  const navigation = useNavigation();
  if (!PEER_MEMORY_AVAILABLE) return null;
  return (
    <SettingsRow
      icon="brain"
      label="Memory"
      onPress={() => navigation.navigate("MemoryProjects")}
    />
  );
}
