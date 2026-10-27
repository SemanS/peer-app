import { pullRequestRows, taskDelivery } from "@t3tools/client-runtime/peer/github";
import { Linking, Pressable, View } from "react-native";
import { AppText as Text } from "../../../components/ui/AppText";
import type { PeerTaskProps } from "../slotTypes";
export function GitHubTaskPullRequests({ project, task }: PeerTaskProps) {
  const rows = pullRequestRows(
      project.work.threads,
      task.id,
      new Map(project.project.members.map((m) => [m.email, m.name])),
    ),
    summary = taskDelivery(project.work.threads, task.id);
  if (!rows.length && !summary.hosts.length) return null;
  return (
    <View className="gap-3">
      <Text className="font-t3-medium text-foreground">Pull requests</Text>
      {rows.map((r) => (
        <View key={r.url} className="gap-1">
          <Pressable
            accessibilityRole="link"
            className="min-h-11 justify-center"
            onPress={() => void Linking.openURL(r.url)}
          >
            <Text className="text-primary">PR #{r.number}</Text>
          </Pressable>
          <Text className="text-foreground-muted">
            {r.headBranch}
            {r.baseBranch ? ` → ${r.baseBranch}` : ""} · {r.state} · {r.source}
          </Text>
          {r.verifiedAt ? (
            <Text className="text-sm text-foreground-muted">
              Verified {r.verifiedAt}
              {r.mergedAt ? ` · merged ${r.mergedAt}` : ""}
              {r.closedAt ? ` · closed ${r.closedAt}` : ""}
              {r.mergeCommit ? ` · merge ${r.mergeCommit}` : ""}
            </Text>
          ) : null}
          {r.note === null ? null : <Text className="text-foreground-muted">{r.note}</Text>}
          {r.state === "closed" ? (
            <Text className="text-foreground-muted">
              An agent cannot finish this task until it merges or a person closes the task.
            </Text>
          ) : null}
        </View>
      ))}
      {summary.hosts.map((host) => (
        <Text key={host} className="text-foreground-muted">
          Delivery on {host} is not verified; a person closes the task.
        </Text>
      ))}
    </View>
  );
}
