import { memo, useCallback } from "react";
import { useNavigation } from "@react-navigation/native";
import { MaterialListRow } from "../../../components/MaterialListRow";
import { shouldShowHomeRow } from "./needsYou.logic";
import { useNeedsYou } from "./useNeedsYou";
const Row = memo(function Row({
  count,
  title,
  onPress,
}: {
  count: number;
  title: string;
  onPress: () => void;
}) {
  return <MaterialListRow title={`Needs you · ${count}`} subtitle={title} onPress={onPress} />;
});
export function HomeNeedsYouRow() {
  const { items } = useNeedsYou(),
    navigation = useNavigation();
  const open = useCallback(() => navigation.navigate("NeedsYou", {}), [navigation]);
  return shouldShowHomeRow(items.length) ? (
    <Row count={items.length} title={items[0]?.title ?? ""} onPress={open} />
  ) : null;
}
