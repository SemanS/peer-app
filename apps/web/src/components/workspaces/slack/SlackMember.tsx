import {
  PEER_SLACK_KINDS,
  type EnvironmentId,
  type PeerSlackSetMineInput,
} from "@t3tools/contracts";
import {
  SLACK_NOT_CONNECTED_LINE,
  slackDelayChoices,
  slackDelayLabel,
  slackKindLabel,
  slackKindsWith,
  slackPlaceChoices,
  slackPlaceOf,
  slackPlaceLabel,
  type SlackMemberPart,
} from "@t3tools/client-runtime/peer/slack";

import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { Checkbox } from "../../ui/checkbox";
import { Switch } from "../../ui/switch";
import { slackAtoms } from "./atoms";
import { SlackFeedback, SlackRow } from "./SlackRow";
import { SlackPicker } from "./SlackPicker";
import { slackDelayFromValue } from "./slack.logic";
import { useSlackRun } from "./useSlackRun";

/**
 * A member's Slack: the link to their own Slack account, the switch that makes their waiting
 * agents post, and when, where and what to post. A workspace without a connection has nothing to
 * choose yet.
 */
export function SlackMember({
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
  const { busy, message, error, run } = useSlackRun(refresh);
  const setMine = useAtomCommand(slackAtoms.setMine, { reportFailure: false });
  const link = useAtomCommand(slackAtoms.link, { reportFailure: false });
  const unlink = useAtomCommand(slackAtoms.unlink, { reportFailure: false });
  if (part.kind === "unconnected") return <SlackRow title={SLACK_NOT_CONNECTED_LINE} />;

  const { view } = part;
  const input = { workspace };
  const change = (changes: Omit<PeerSlackSetMineInput, "workspace">) =>
    void run(() => setMine({ environmentId, input: { ...input, ...changes } }));
  return (
    <>
      <SlackRow
        title="Your Slack account"
        description={
          view.link.kind === "pending" ? `${view.link.text} Then choose Refresh.` : view.link.text
        }
        control={
          view.link.kind === "linked" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void run(() => unlink({ environmentId, input }))}
            >
              Unlink
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void run(() => link({ environmentId, input }))}
            >
              {view.link.kind === "pending" ? "Link again" : "Link"}
            </Button>
          )
        }
      />
      <SlackRow
        title="Ask me in Slack"
        description={
          view.switchReason ??
          (view.on
            ? "Your agents post in Slack when they wait for you."
            : "Off until you turn it on.")
        }
        control={
          <Switch
            aria-label="Ask me in Slack"
            checked={view.on}
            disabled={busy || view.switchReason !== null}
            onCheckedChange={(enabled) => change({ enabled })}
          />
        }
      />
      <SlackRow
        title="Delay"
        description="How long an agent waits before Peer posts it. Answering in Peer first cancels the post."
        control={
          <SlackPicker
            label="Delay"
            value={String(view.delay)}
            items={slackDelayChoices(view.delay).map((minutes) => ({
              value: String(minutes),
              label: slackDelayLabel(minutes),
            }))}
            disabled={busy}
            onChange={(value) => {
              const delayMinutes = slackDelayFromValue(value);
              if (delayMinutes !== null) change({ delayMinutes });
            }}
          />
        }
      />
      <SlackRow
        title="Post in"
        description="The narrower of your choice and the project's applies."
        control={
          <SlackPicker
            label="Post in"
            value={view.place}
            items={slackPlaceChoices(view.place).map((place) => ({
              value: place,
              label: slackPlaceLabel(place),
            }))}
            disabled={busy}
            onChange={(value) => {
              const place = slackPlaceOf(value);
              if (place !== null) change({ place });
            }}
          />
        }
      />
      <SlackRow
        title="What to post"
        description="Blocked prompts are notices: answer them at the computer."
      >
        <div className="flex flex-wrap gap-x-6 gap-y-2 pb-3 pl-4">
          {PEER_SLACK_KINDS.map((kind) => (
            <label key={kind} className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={view.kinds.includes(kind)}
                disabled={busy}
                onCheckedChange={(checked) =>
                  change({ kinds: slackKindsWith(view.kinds, kind, checked) })
                }
              />
              {slackKindLabel(kind)}
            </label>
          ))}
        </div>
      </SlackRow>
      <SlackFeedback message={message} error={error} />
    </>
  );
}
