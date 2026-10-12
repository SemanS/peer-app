import {
  PEER_SLACK_KINDS,
  type EnvironmentId,
  type PeerSlackSetMineInput,
} from "@t3tools/contracts";
import {
  slackDelayChoices,
  slackKindLabel,
  slackKindsWith,
  slackPlaceChoices,
  slackPlaceOf,
  slackPlaceLabel,
  type SlackMemberView,
} from "@t3tools/client-runtime/peer/slack";

import { useAtomCommand } from "../../../state/use-atom-command";
import { ConnectionBadge } from "../../settings/ConnectionStatus";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { Button } from "../../ui/button";
import { Checkbox } from "../../ui/checkbox";
import { Switch } from "../../ui/switch";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { slackAtoms } from "./atoms";
import { SlackFeedback, SlackRow } from "./SlackRow";
import { SlackPicker } from "./SlackPicker";
import { slackDelayFromValue, slackDelayShort, type SlackAccountView } from "./slack.logic";
import { useSlackRun } from "./useSlackRun";

/**
 * A member’s Slack once the workspace has connected it (design artboard 4d): the account they linked,
 * the switch that makes their waiting agents post, how long to wait, where and what to post.
 */
export function SlackMember({
  environmentId,
  workspace,
  account,
  options,
  refresh,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly account: SlackAccountView;
  readonly options: SlackMemberView;
  readonly refresh: () => void;
}) {
  const { busy, message, error, run } = useSlackRun(refresh);
  const setMine = useAtomCommand(slackAtoms.setMine, { reportFailure: false });
  const link = useAtomCommand(slackAtoms.link, { reportFailure: false });
  const unlink = useAtomCommand(slackAtoms.unlink, { reportFailure: false });
  const input = { workspace };
  const change = (changes: Omit<PeerSlackSetMineInput, "workspace">) =>
    void run(() => setMine({ environmentId, input: { ...input, ...changes } }));
  return (
    <>
      <SettingsGroup>
        <SlackRow
          title={
            <>
              Your Slack account
              <ConnectionBadge state={account.status.state} />
            </>
          }
          description={account.text}
          control={
            account.action === "unlink" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void run(() => unlink({ environmentId, input }))}
              >
                Unlink
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                {account.action === "link-again" ? (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={refresh}>
                    Refresh
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void run(() => link({ environmentId, input }))}
                >
                  {account.action === "link-again" ? "Link again" : "Link"}
                </Button>
              </div>
            )
          }
        />
        <SlackRow
          title="Ask me in Slack"
          description={
            options.switchReason ??
            (options.on
              ? "Your agents post in Slack when they wait for you."
              : "Off until you turn it on.")
          }
          control={
            <Switch
              aria-label="Ask me in Slack"
              checked={options.on}
              disabled={busy || options.switchReason !== null}
              onCheckedChange={(enabled) => change({ enabled })}
            />
          }
        />
        <SlackRow
          title="Wait before posting"
          description="Answering in Peer first cancels the post."
          control={
            <ToggleGroup
              aria-label="Wait before posting"
              value={[String(options.delay)]}
              disabled={busy}
              onValueChange={(next) => {
                const delayMinutes = slackDelayFromValue(next[0] ?? "");
                if (delayMinutes !== null && delayMinutes !== options.delay) {
                  change({ delayMinutes });
                }
              }}
            >
              {slackDelayChoices(options.delay).map((minutes) => (
                <Toggle key={minutes} value={String(minutes)}>
                  {slackDelayShort(minutes)}
                </Toggle>
              ))}
            </ToggleGroup>
          }
        />
        <SlackRow
          title="Where"
          description="The project’s thread, or direct messages only. The narrower of yours and the project’s applies."
          control={
            <SlackPicker
              label="Where"
              value={options.place}
              items={slackPlaceChoices(options.place).map((place) => ({
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
          title="What"
          description="Blocked prompts are notices: answer them at the computer."
        >
          <div className="flex flex-wrap gap-x-6 gap-y-2 pb-3">
            {PEER_SLACK_KINDS.map((kind) => (
              <label key={kind} className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={options.kinds.includes(kind)}
                  disabled={busy}
                  onCheckedChange={(checked) =>
                    change({ kinds: slackKindsWith(options.kinds, kind, checked) })
                  }
                />
                {slackKindLabel(kind)}
              </label>
            ))}
          </div>
        </SlackRow>
      </SettingsGroup>
      <SlackFeedback message={message} error={error} />
    </>
  );
}
