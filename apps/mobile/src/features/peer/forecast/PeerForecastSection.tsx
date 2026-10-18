import { View } from "react-native";
import {
  forecastAvailable,
  forecastSections,
  forecastSide,
  forecastPairKey,
  forecastSettings,
} from "@t3tools/client-runtime/peer-forecast";
import { AppText as Text } from "../../../components/ui/AppText";
import { serverEnvironment } from "../../../state/server";
import { useEnvironmentQuery } from "../../../state/query";
import { SettingsSection } from "../../settings/components/SettingsSection";
import type { PeerSectionProps } from "../slotTypes";
import { forecastAdviceText } from "./forecastSection.logic";
export function PeerForecastSection({ environmentId, status }: PeerSectionProps) {
  const plugin = status.plugins?.find((p) => p.id === "forecast"),
    query = useEnvironmentQuery(
      plugin?.active ? serverEnvironment.peerForecastLive({ environmentId, input: {} }) : null,
    );
  const value =
    plugin?.enabled === false
      ? {
          state: "off" as const,
          reason: "disabled" as const,
          teammates: false,
          pairs: [],
          tracked: 0,
          skipped: 0,
          notOnOrigin: 0,
          paused: [],
        }
      : forecastAvailable(query);
  if (plugin === undefined || value === "unavailable") return null;
  const sections = forecastSections(value);
  if (value.state === "on" && sections.length === 0) return null;
  return (
    <SettingsSection title="Predicted merge conflicts">
      <View className="gap-2 p-4">
        {value.state !== "on" ? (
          // Times are told only while it is on, and this line is for it being off or unsupported.
          <Text>{forecastSettings(value, 0).join(" ")} Change it on web or desktop.</Text>
        ) : (
          <>
            <Text>{forecastAdviceText(status, value.pairs)}</Text>
            {sections.map((section) => (
              <View key={section.project ?? "pairs"} className="gap-2">
                {section.project ? <Text>{section.project}</Text> : null}
                {section.pairs.map((pair) => (
                  <View key={forecastPairKey(pair)}>
                    <Text>
                      {forecastSide(pair.a, status.email)} ↔ {forecastSide(pair.b, status.email)}
                    </Text>
                    <Text>
                      {pair.files.join(", ")}
                      {pair.more ? ` and ${pair.more} more files` : ""}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </>
        )}
      </View>
    </SettingsSection>
  );
}
