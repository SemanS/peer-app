import type { PeerSlackAdminResult } from "@t3tools/contracts";
import {
  slackActivityRows,
  slackConnectionRows,
  slackSetupStep,
} from "@t3tools/client-runtime/peer/slack";
import { View } from "react-native";

import { AppText as Text } from "../../../components/AppText";

/**
 * What an owner or admin reads of the connection on the phone: its state, the Slack workspace and
 * bot, what Slack reports as wrong, and its recent activity. Connecting Slack, choosing channels
 * and disconnecting stay on web and desktop, where the Slack app is created.
 */
export function SlackConnection({ admin }: { readonly admin: PeerSlackAdminResult }) {
  const { problems } = slackSetupStep(admin);
  return (
    <View className="gap-2">
      <Text className="font-t3-medium text-foreground">Connection</Text>
      {slackConnectionRows(admin).map((row) => (
        <Text key={row.label} className="text-foreground">
          {row.label}: {row.value}
        </Text>
      ))}
      {problems.map((problem) => (
        <Text
          key={`${problem.project ?? ""}:${problem.code}`}
          accessibilityRole="alert"
          className="text-destructive"
        >
          {problem.project === undefined
            ? problem.sentence
            : `${admin.projects.find((project) => project.id === problem.project)?.name ?? problem.project}: ${problem.sentence}`}
        </Text>
      ))}
      {slackActivityRows(admin).map((row) => (
        <Text key={row.label} className="text-sm text-foreground-muted">
          {row.label}: {row.value}
        </Text>
      ))}
      <Text className="text-sm text-foreground-muted">
        Connect Slack, choose channels or disconnect in Peer on web or desktop.
      </Text>
    </View>
  );
}
