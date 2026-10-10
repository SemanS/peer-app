import {
  PEER_SLACK_KINDS,
  type EnvironmentId,
  type PeerSlackSetMineInput,
} from "@t3tools/contracts";
import {
  SLACK_NOT_CONNECTED_LINE,
  slackDelayChoices,
  slackDelayLabel,
  slackDelayOf,
  slackKindLabel,
  slackKindsWith,
  slackPlaceChoices,
  slackPlaceOf,
  slackPlaceLabel,
  type SlackMemberPart,
} from "@t3tools/client-runtime/peer/slack";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../../components/AppText";
import { SegmentedControl } from "../../../components/SegmentedControl";
import { ThemedSwitch } from "../../../components/ThemedSwitch";
import { useAtomCommand } from "../../../state/use-atom-command";
import { slackAtoms } from "./atoms";
import { useSlackRun } from "./useSlackRun";

/**
 * The segments of a place share one line of a phone, so they get short labels; the full ones stay
 * as accessibility labels.
 */
const PLACE_LABELS: Readonly<Record<string, string>> = {
  thread: "Project thread",
  direct: "Direct messages",
};

/**
 * A member's Slack on the phone: the link to their own Slack account, the switch that makes their
 * waiting agents post, and when, where and what to post. A workspace without a connection has
 * nothing to choose yet.
 */
export function SlackMemberOptions({
  environmentId,
  workspace,
  part,
  refresh,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly part: SlackMemberPart;
  readonly refresh: () => void;
}) {
  const { busy, error, run } = useSlackRun(refresh);
  const setMine = useAtomCommand(slackAtoms.setMine, { reportFailure: false });
  const link = useAtomCommand(slackAtoms.link, { reportFailure: false });
  const unlink = useAtomCommand(slackAtoms.unlink, { reportFailure: false });
  if (part.kind === "unconnected") {
    return <Text className="text-foreground-muted">{SLACK_NOT_CONNECTED_LINE}</Text>;
  }

  const { view } = part;
  const input = { workspace };
  const change = (changes: Omit<PeerSlackSetMineInput, "workspace">) =>
    void run(() => setMine({ environmentId, input: { ...input, ...changes } }));
  return (
    <View className="gap-3">
      <Text className="font-t3-medium text-foreground">Your Slack account</Text>
      <Text selectable className="text-foreground-muted">
        {view.link.kind === "pending" ? `${view.link.text} Then choose Refresh.` : view.link.text}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={() =>
          void run(() =>
            view.link.kind === "linked"
              ? unlink({ environmentId, input })
              : link({ environmentId, input }),
          )
        }
        className="py-2"
      >
        <Text className="text-primary">
          {view.link.kind === "linked"
            ? "Unlink"
            : view.link.kind === "pending"
              ? "Link again"
              : "Link"}
        </Text>
      </Pressable>

      <View className="flex-row items-center gap-4">
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-foreground">Ask me in Slack</Text>
          <Text className="text-sm text-foreground-muted">
            {view.switchReason ??
              (view.on
                ? "Your agents post in Slack when they wait for you."
                : "Off until you turn it on.")}
          </Text>
        </View>
        <ThemedSwitch
          accessibilityLabel="Ask me in Slack"
          value={view.on}
          disabled={busy || view.switchReason !== null}
          onValueChange={(enabled) => change({ enabled })}
        />
      </View>

      <Text className="text-foreground">Delay</Text>
      <SegmentedControl
        options={slackDelayChoices(view.delay).map((minutes) => ({
          value: minutes,
          label: minutes === 0 ? "Now" : `${minutes} min`,
          accessibilityLabel: slackDelayLabel(minutes),
        }))}
        selected={view.delay}
        onSelect={(minutes) => {
          const delayMinutes = slackDelayOf(minutes);
          if (!busy && delayMinutes !== null && minutes !== view.delay) change({ delayMinutes });
        }}
      />

      <Text className="text-foreground">Post in</Text>
      <SegmentedControl
        options={slackPlaceChoices(view.place).map((place) => ({
          value: place,
          label: PLACE_LABELS[place] ?? slackPlaceLabel(place),
          accessibilityLabel: slackPlaceLabel(place),
        }))}
        selected={view.place}
        onSelect={(value) => {
          const place = slackPlaceOf(value);
          if (!busy && place !== null && value !== view.place) change({ place });
        }}
      />

      <Text className="text-foreground">What to post</Text>
      {PEER_SLACK_KINDS.map((kind) => (
        <View key={kind} className="flex-row items-center gap-4">
          <Text className="min-w-0 flex-1 text-foreground">{slackKindLabel(kind)}</Text>
          <ThemedSwitch
            accessibilityLabel={slackKindLabel(kind)}
            value={view.kinds.includes(kind)}
            disabled={busy}
            onValueChange={(on) => change({ kinds: slackKindsWith(view.kinds, kind, on) })}
          />
        </View>
      ))}
      <Text className="text-sm text-foreground-muted">
        Blocked prompts are notices: answer them at the computer.
      </Text>
      {error === null ? null : (
        <Text accessibilityRole="alert" className="text-destructive">
          {error}
        </Text>
      )}
    </View>
  );
}
