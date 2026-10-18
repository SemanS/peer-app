import type { EnvironmentId, ReviewDiffInput } from "@t3tools/contracts";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../../components/ui/AppText";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { CHANGES_WORDS, phoneReviewDiff } from "./changes.logic";

/**
 * What moved in a change, read from the computer that holds it: the files since the person's mark
 * (the whole change before a first review). Reading only: marking reviewed runs on the computer.
 */
export function ReviewDiffPanel({
  environmentId,
  input,
}: {
  readonly environmentId: EnvironmentId;
  readonly input: ReviewDiffInput;
}) {
  const query = useEnvironmentQuery(
    serverEnvironment.peerChangesReviewDiff({ environmentId, input }),
  );
  if (query.error !== null) {
    return (
      <View className="gap-1">
        <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
          {query.error}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={query.refresh}
          className="min-h-11 justify-center"
        >
          <Text className="text-primary">{CHANGES_WORDS.retry}</Text>
        </Pressable>
      </View>
    );
  }
  if (query.data === null) {
    return <Text className="text-sm text-foreground-muted">{CHANGES_WORDS.loadingRead}</Text>;
  }
  const { notes, files } = phoneReviewDiff(query.data);
  return (
    <View className="gap-1">
      {notes.map((note) => (
        <Text key={note} className="text-sm text-foreground-muted">
          {note}
        </Text>
      ))}
      {files.map((file) => (
        <View key={file.path} className="flex-row items-center justify-between gap-2">
          <Text selectable numberOfLines={1} className="min-w-0 flex-1 font-mono text-sm">
            {file.path}
          </Text>
          <Text className="text-xs text-foreground-muted">{file.stat}</Text>
        </View>
      ))}
    </View>
  );
}
