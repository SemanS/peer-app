import { useNavigation } from "@react-navigation/native";
import { NavigationRow } from "../../../components/ui/NavigationRow";
import type { PeerSectionProps } from "../slotTypes";
import { NeedsYouAlertsRow } from "./NeedsYouAlertsRow";
import { useNeedsYou } from "./useNeedsYou";
export function NeedsYouWorkspace(props: PeerSectionProps) {
  const navigation = useNavigation(),
    { items } = useNeedsYou();
  return (
    <>
      <NavigationRow
        title={`Needs you · ${items.length}`}
        subtitle="Approvals, answers and work to review"
        onPress={() => navigation.navigate("NeedsYou", {})}
      />
      <NeedsYouAlertsRow {...props} />
    </>
  );
}
