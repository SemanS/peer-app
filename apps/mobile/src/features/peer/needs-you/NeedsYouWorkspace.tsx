import { useNavigation } from "@react-navigation/native";
import { MaterialListRow } from "../../../components/MaterialListRow";
import type { PeerSectionProps } from "../slotTypes";
import { NeedsYouAlertsRow } from "./NeedsYouAlertsRow";
import { useNeedsYou } from "./useNeedsYou";
export function NeedsYouWorkspace(props: PeerSectionProps) {
  const navigation = useNavigation(),
    { items } = useNeedsYou();
  return (
    <>
      <MaterialListRow
        title={`Needs you · ${items.length}`}
        subtitle="Approvals, answers and work to review"
        onPress={() => navigation.navigate("NeedsYou", {})}
      />
      <NeedsYouAlertsRow {...props} />
    </>
  );
}
