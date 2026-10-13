import { projectColor } from "@t3tools/client-runtime/peer/work";
import { View } from "react-native";

import { AppText } from "../../../components/AppText";
import { cn } from "../../../lib/cn";
import { projectIconColorClassNames } from "../../../lib/projectIcon";
import { initialOf } from "./words";

/**
 * A person's mark: their initial in a color taken from their address, so they have the same one
 * in the Team section and on the card of a call they asked. The color tells people apart and never
 * says a state; the name always stands beside it.
 */
export function PersonMark({
  name,
  colorKey,
  small = false,
}: {
  readonly name: string;
  readonly colorKey: string;
  readonly small?: boolean;
}) {
  const colors = projectIconColorClassNames(projectColor(colorKey));
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={cn(
        "items-center justify-center rounded-full",
        small ? "size-6" : "size-7",
        colors.background,
      )}
    >
      <AppText className={cn("text-2xs font-t3-bold", colors.text)}>{initialOf(name)}</AppText>
    </View>
  );
}
