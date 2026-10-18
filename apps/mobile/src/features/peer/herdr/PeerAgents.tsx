import { peerCoordinationDetail, peerCoordinationLabel } from "@t3tools/client-runtime/peer/herdr";
import { View } from "react-native";

import { AppText as Text } from "../../../components/ui/AppText";
import { SettingsSection } from "../../settings/components/SettingsSection";
import type { PeerEnvironmentProps } from "../slotTypes";
import { herdrNoAgentsText, herdrPostHocPathsText } from "./herdrRuntime.logic";

/** The agents herdr runs on the environment, and what coordination each one's session supports. */
export function PeerAgents({ status }: PeerEnvironmentProps) {
  return (
    <SettingsSection title="Agents on this environment">
      {(status.agents.postHocSkipped ?? 0) > 0 ? (
        <Text className="p-4 text-foreground-muted">
          {status.agents.postHocSkipped} agents' observations exceed the team's report limit.
        </Text>
      ) : null}
      {status.agents.list.length === 0 ? (
        <Text className="p-4 text-foreground-muted">{herdrNoAgentsText(status)}</Text>
      ) : (
        status.agents.list.map((agent) => (
          <View key={agent.id} className="gap-1 p-4">
            <Text className="font-t3-medium text-foreground">
              {agent.title} · {agent.status}
            </Text>
            <Text className="text-sm text-foreground-muted">
              {peerCoordinationLabel(
                agent.coordinationLevel,
                status.mcp?.agents.includes(agent.id),
              )}
            </Text>
            <Text className="text-sm text-foreground-muted">
              {peerCoordinationDetail(
                agent.coordinationLevel,
                status.mcp?.agents.includes(agent.id),
              )}
            </Text>
            {agent.coordinationLevel === "C" && agent.postHocPaths !== undefined ? (
              <Text className="text-sm text-foreground-muted">
                {herdrPostHocPathsText(agent.postHocPaths.length, agent.vcs)}
              </Text>
            ) : null}
            {(agent.postHocPathsTruncated ?? 0) > 0 ? (
              <Text className="text-sm text-foreground-muted">
                {agent.postHocPathsTruncated} additional paths remain local.
              </Text>
            ) : null}
          </View>
        ))
      )}
    </SettingsSection>
  );
}
