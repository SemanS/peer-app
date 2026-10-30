import { memo, useCallback } from "react";
import { useNavigation } from "@react-navigation/native";
import { NavigationRow } from "../../../components/ui/NavigationRow";
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
  return <NavigationRow title={`Needs you · ${count}`} subtitle={title} onPress={onPress} />;
});
export function HomeNeedsYouRow() {
  const { items, rooms, count } = useNeedsYou(),
    navigation = useNavigation();
  const open = useCallback(() => navigation.navigate("NeedsYou", {}), [navigation]);
  return shouldShowHomeRow(count) ? (
    <Row count={count} title={items[0]?.title ?? rooms[0]?.title ?? ""} onPress={open} />
  ) : null;
}
