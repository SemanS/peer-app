import { projectColor } from "@t3tools/client-runtime/peer/work";
import { View } from "react-native";

import { SymbolView, type AppSymbolName } from "../../../components/AppSymbol";
import { AppText } from "../../../components/AppText";
import { cn } from "../../../lib/cn";
import { projectIconColorClassNames } from "../../../lib/projectIcon";
import type { SignalTone } from "../slotTypes";
import { TONE_SURFACE, TONE_TEXT, TONE_TINT } from "./signals";

/** A chip in a signal's color. It always says what it means; the color only repeats it. */
export function ToneChip({
  tone,
  label,
  icon,
}: {
  readonly tone: SignalTone;
  readonly label: string;
  readonly icon?: AppSymbolName;
}) {
  return (
    <View
      className={cn(
        "flex-row items-center gap-1 rounded-full border px-2 py-0.5",
        TONE_SURFACE[tone],
      )}
    >
      {icon === undefined ? null : (
        <SymbolView name={icon} size={12} tintColorClassName={TONE_TINT[tone]} type="monochrome" />
      )}
      <AppText className={cn("text-2xs font-t3-medium", TONE_TEXT[tone])} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

/**
 * A project's square mark in its color, as web draws it. The color only says which project
 * something is in, never a state, and comes from the project's key so it is the same everywhere.
 */
export function WorkProjectMark({
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
      className={cn(
        "items-center justify-center rounded-md",
        small ? "size-5" : "size-8",
        colors.background,
      )}
    >
      <AppText className={cn("font-t3-bold", small ? "text-3xs" : "text-sm", colors.text)}>
        {Array.from(name.trim())[0]?.toUpperCase() ?? "?"}
      </AppText>
    </View>
  );
}
