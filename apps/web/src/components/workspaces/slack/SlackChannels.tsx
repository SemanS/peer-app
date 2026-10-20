import type {
  EnvironmentId,
  PeerSlackAdminResult,
  PeerSlackChannels,
  PeerSlackSetChannelsInput,
} from "@t3tools/contracts";

import type { EnvironmentQueryView } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Switch } from "../../ui/switch";
import { slackAtoms } from "./atoms";
import { SlackPicker } from "./SlackPicker";
import { SlackRow } from "./SlackRow";
import {
  slackChannelFromValue,
  slackChannelItems,
  slackChannelLabel,
  slackDefaultChange,
  slackDefaultItems,
  slackDefaultValue,
  slackModeFromValue,
  slackProjectRows,
} from "./slack.logic";
import type { SlackRun } from "./useSlackRun";

/**
 * Where agents post: a default channel for every project without its own, and per project a
 * channel and how its agents may post. The channels come from Slack when the step opens.
 */
export function SlackChannels({
  environmentId,
  workspace,
  admin,
  channels,
  busy,
  run,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly admin: PeerSlackAdminResult;
  readonly channels: EnvironmentQueryView<PeerSlackChannels>;
  readonly busy: boolean;
  readonly run: SlackRun;
}) {
  const setChannels = useAtomCommand(slackAtoms.setChannels, { reportFailure: false });
  const save = (changes: Omit<PeerSlackSetChannelsInput, "workspace">) =>
    void run(() => setChannels({ environmentId, input: { workspace, ...changes } }), "Saved.");
  const listed = channels.data?.channels ?? [];
  // Pickers wait for Slack's list; the Hub would refuse a channel the bot cannot see anyway.
  const pickable = !busy && channels.data !== null;
  const channelsNote =
    channels.error !== null ? (
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <p role="alert" className="text-sm text-destructive-foreground">
          Could not load Slack's channels: {channels.error}
        </p>
        <Button variant="outline" size="sm" onClick={channels.refresh}>
          Retry
        </Button>
      </div>
    ) : channels.data === null ? (
      <p role="status" className="pb-3 text-sm text-muted-foreground">
        Loading Slack's channels…
      </p>
    ) : null;
  return (
    <>
      <SlackRow
        title="Default channel"
        description="Where agents post for projects without a channel of their own."
        control={
          <SlackPicker
            label="Default channel"
            value={slackDefaultValue(admin)}
            items={slackDefaultItems(listed, admin)}
            disabled={!pickable}
            onChange={(value) => save(slackDefaultChange(admin, value))}
          />
        }
      >
        {channelsNote}
      </SlackRow>
      {admin.intercomAvailable ? (
        <SlackRow
          title="Peer intercom"
          description="Discuss overlapping work and project knowledge in a shared Slack thread. Both colleagues must use channel threads. Replies also reach linked agents."
          control={
            <Switch
              aria-label="Peer intercom"
              checked={admin.intercom ?? false}
              disabled={busy}
              onCheckedChange={(intercom) => save({ intercom })}
            />
          }
        />
      ) : null}
      {slackProjectRows(admin).map((row) => (
        <SlackRow
          key={row.id}
          title={
            <>
              {row.name}
              {row.restricted ? <Badge variant="outline">Named members</Badge> : null}
            </>
          }
          description={
            row.problem === null && row.note === null ? undefined : (
              <>
                {row.problem === null ? null : (
                  <span className="text-destructive-foreground">{row.problem} </span>
                )}
                {row.note}
              </>
            )
          }
          control={
            <div className="flex flex-wrap items-center gap-2">
              <SlackPicker
                label={`Channel for ${row.name}`}
                value={row.channel}
                items={slackChannelItems(
                  listed,
                  admin.projects.find((project) => project.id === row.id)?.channel ?? null,
                  admin.default === null
                    ? "No channel"
                    : `Default channel (${slackChannelLabel(admin.default)})`,
                )}
                disabled={!pickable || row.channelDisabled}
                onChange={(value) =>
                  save({ projects: { [row.id]: { channel: slackChannelFromValue(value) } } })
                }
              />
              <SlackPicker
                label={`How agents post for ${row.name}`}
                value={row.mode}
                items={row.modes}
                disabled={busy}
                onChange={(value) => {
                  const mode = slackModeFromValue(value);
                  if (mode !== null) save({ projects: { [row.id]: { mode } } });
                }}
              />
            </div>
          }
        />
      ))}
    </>
  );
}
