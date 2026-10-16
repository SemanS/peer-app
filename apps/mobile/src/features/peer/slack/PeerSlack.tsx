import type { EnvironmentId, PeerWorkspaceState } from "@t3tools/contracts";
import {
  SLACK_OLDER_HUB_LINE,
  isSlackAdmin,
  slackLoad,
  slackMemberPart,
} from "@t3tools/client-runtime/peer/slack";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../../components/ui/AppText";
import { useEnvironmentQuery } from "../../../state/query";
import { SettingsSection } from "../../settings/components/SettingsSection";
import type { PeerSectionProps } from "../slotTypes";
import { slackAtoms } from "./atoms";
import { SlackConnection } from "./SlackConnection";
import { SlackMemberOptions } from "./SlackMemberOptions";

/**
 * Slack for each workspace on the Peer workspaces screen. Every member gets their link and
 * options, owners and admins also the connection's state and problems. A workspace reads from the
 * Hub when it is opened and again after each action or Refresh; nothing refreshes on a timer.
 */
export function PeerSlack({ environmentId, status }: PeerSectionProps) {
  return status.workspaces.map((workspace) => (
    <WorkspaceSlack key={workspace.slug} environmentId={environmentId} workspace={workspace} />
  ));
}

function WorkspaceSlack({
  environmentId,
  workspace,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: PeerWorkspaceState;
}) {
  const [open, setOpen] = useState(false);
  const admin = isSlackAdmin(workspace.role);
  const input = { workspace: workspace.slug };
  const me = useEnvironmentQuery(open ? slackAtoms.me({ environmentId, input }) : null);
  const connection = useEnvironmentQuery(
    open && admin ? slackAtoms.admin({ environmentId, input }) : null,
  );
  const load = slackLoad(admin, { me, admin: connection });
  const part = load.kind === "ready" ? slackMemberPart(admin, load.me) : null;
  const refresh = () => {
    me.refresh();
    connection.refresh();
  };
  return (
    <SettingsSection title={`Slack · ${workspace.name}`}>
      <View className="gap-3 p-4">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen(!open)}
          className="py-2"
        >
          <Text className="text-primary">{open ? "Hide Slack" : "Show Slack"}</Text>
        </Pressable>
        {open ? (
          <>
            <Text className="text-sm text-foreground-muted">
              Your agents ask you in Slack when they wait, and your replies go back to them.
            </Text>
            {load.kind === "error" ? null : (
              <Pressable
                accessibilityRole="button"
                disabled={me.isPending || connection.isPending}
                onPress={refresh}
                className="py-2"
              >
                <Text className="text-primary">Refresh</Text>
              </Pressable>
            )}
            {load.kind === "loading" ? (
              <Text className="text-foreground-muted">Loading Slack…</Text>
            ) : null}
            {load.kind === "older-hub" ? (
              <Text className="text-foreground-muted">{SLACK_OLDER_HUB_LINE}</Text>
            ) : null}
            {load.kind === "error" ? (
              <>
                <Text accessibilityRole="alert" className="text-destructive">
                  {load.message}
                </Text>
                <Pressable accessibilityRole="button" onPress={refresh} className="py-2">
                  <Text className="text-primary">Retry</Text>
                </Pressable>
              </>
            ) : null}
            {load.kind === "ready" ? (
              <>
                {load.admin === null ? null : <SlackConnection admin={load.admin} />}
                {part === null ? null : (
                  <SlackMemberOptions
                    environmentId={environmentId}
                    workspace={workspace.slug}
                    part={part}
                    refresh={refresh}
                  />
                )}
              </>
            ) : null}
          </>
        ) : null}
      </View>
    </SettingsSection>
  );
}
