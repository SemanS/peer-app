import { useNavigation } from "@react-navigation/native";
import { memo, useCallback } from "react";

import { MaterialListRow } from "../../../components/MaterialListRow";
import { useNeedsYouEnvironments } from "../needs-you/useNeedsYou";
import { homeWorkSubtitle } from "./work.logic";
import { useWorkScope } from "./workScope";

const Row = memo(function Row({ subtitle, onPress }: { subtitle: string; onPress: () => void }) {
  return <MaterialListRow title="Work" subtitle={subtitle} onPress={onPress} />;
});

/**
 * The Work row under Needs you, while a computer reports a team project. It reads the light Needs
 * you status Home already holds; the Work screen subscribes to the full one only while it is open.
 */
export function HomeWorkRow() {
  const environments = useNeedsYouEnvironments();
  const [scope] = useWorkScope();
  const navigation = useNavigation();
  const open = useCallback(() => navigation.navigate("Work"), [navigation]);
  const subtitle = homeWorkSubtitle(
    environments.map((environment) => environment.status),
    scope,
  );
  return subtitle === null ? null : <Row subtitle={subtitle} onPress={open} />;
}
