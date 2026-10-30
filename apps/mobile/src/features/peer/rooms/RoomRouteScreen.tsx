import type { StaticScreenProps } from "@react-navigation/native";
import { taskLabel } from "@t3tools/client-runtime/peer/needs-you";
import { targetsFor, type RoomAction } from "@t3tools/client-runtime/peer/rooms";
import { personName } from "@t3tools/client-runtime/peer/work";
import { EnvironmentId, type PeerHubStatus, type PeerRoomMessage } from "@t3tools/contracts";
import { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, View } from "react-native";

import { AppText } from "../../../components/ui/AppText";
import { NativeStackScreenOptions } from "../../../native/StackHeader";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { SettingsScreen } from "../../settings/components/SettingsScreen";
import { PeerPluginGate } from "../PluginOff";
import { RoomComposer } from "./RoomComposer";
import { RoomMessageRow } from "./RoomMessageRow";
import {
  ROOM_READ_LIMIT,
  UNCONFIRMED_MOVE,
  messageView,
  olderLeftOut,
  type RoomCommandEnd,
} from "./rooms.logic";
import { useRoom } from "./useRoom";
import { useRoomMoves } from "./useRoomMoves";

function Room({
  environmentId,
  status,
  workspace,
  projectId,
  taskId,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly workspace: string;
  readonly projectId: string;
  readonly taskId: string;
}) {
  const place = useMemo(
    () => ({ workspace, project: projectId, task: taskId }),
    [projectId, taskId, workspace],
  );
  const project = status.workspaces
    .find((row) => row.slug === workspace)
    ?.projects.find((row) => row.project.id === projectId);
  const task = project?.work.tasks.find((row) => row.id === taskId);
  const { view, error, refresh, apply } = useRoom({ environmentId, status, place });
  const runs = useEnvironmentQuery(
    serverEnvironment.peerRunsList({ environmentId, input: { workspace, projectId, taskId } }),
  );
  const { allowed, move, askDecline } = useRoomMoves(environmentId);
  const [acting, setActing] = useState<number | null>(null);
  const [failure, setFailure] = useState<{
    readonly seq: number;
    readonly message: string;
  } | null>(null);

  const me = status.email;
  const nameOf = useCallback(
    (email: string) => (project === undefined ? email : personName(project, email)),
    [project],
  );
  const finish = useCallback(
    (seq: number, end: RoomCommandEnd<PeerRoomMessage>) => {
      setActing(null);
      if (end.kind === "done") apply(end.value);
      else setFailure({ seq, message: end.kind === "unknown" ? UNCONFIRMED_MOVE : end.message });
      // The Hub's room is the truth: a failure may mean this view was out of date.
      refresh();
    },
    [apply, refresh],
  );
  const onAction = useCallback(
    (seq: number, action: RoomAction, expect: string) => {
      const start = () => {
        setActing(seq);
        setFailure(null);
      };
      if (action === "decline") {
        askDecline(place, seq, expect, start, (end) => finish(seq, end));
        return;
      }
      start();
      void move(place, seq, action, expect).then((end) => finish(seq, end));
    },
    [askDecline, finish, move, place],
  );

  const rows = useMemo(
    () => (view?.messages ?? []).map((message) => messageView(message, { me, nameOf })),
    [me, nameOf, view],
  );
  const list = useRef<FlatList<(typeof rows)[number]>>(null);
  const followed = useRef<number | null>(null);
  const newest = rows.at(-1)?.seq ?? null;
  // Not an inverted list: the automatic inset under the glass header lands on the wrong edge of one.
  const followNewest = () => {
    if (newest === followed.current) return;
    followed.current = newest;
    list.current?.scrollToEnd({ animated: false });
  };
  const targets = useMemo(
    () =>
      project === undefined || task === undefined || me === null
        ? []
        : targetsFor(project.project, task, runs.data?.runs ?? [], me, {
            ...(view?.hasCheckout === undefined ? {} : { hasCheckout: view.hasCheckout }),
            reaches: view?.reaches ?? [],
            nameOf,
          }),
    [me, nameOf, project, runs.data, task, view],
  );
  const title = task === undefined ? "Room" : taskLabel(task);

  return (
    <>
      <NativeStackScreenOptions
        options={{ title, ...(Platform.OS === "android" ? { headerShown: false } : {}) }}
      />
      <SettingsScreen title={title}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1"
        >
          {error === null ? null : (
            <View className="gap-1 px-5 pt-3">
              <AppText accessibilityRole="alert" className="text-destructive">
                {error}
              </AppText>
              <Pressable accessibilityRole="button" className="min-h-11" onPress={refresh}>
                <AppText className="text-primary">Retry</AppText>
              </Pressable>
            </View>
          )}
          <FlatList
            ref={list}
            className="flex-1"
            contentContainerClassName="gap-3 px-5 py-4"
            contentInsetAdjustmentBehavior="automatic"
            keyboardShouldPersistTaps="handled"
            initialNumToRender={ROOM_READ_LIMIT}
            onContentSizeChange={followNewest}
            data={rows}
            keyExtractor={(row) => row.key}
            renderItem={({ item }) => (
              <RoomMessageRow
                view={item}
                busy={acting !== null}
                canAct={allowed}
                error={failure?.seq === item.seq ? failure.message : null}
                onAction={onAction}
              />
            )}
            ListEmptyComponent={
              <AppText accessibilityLiveRegion="polite" className="text-foreground-muted">
                {view === null
                  ? error === null
                    ? "Loading the room…"
                    : ""
                  : "No messages yet. The first one starts the room."}
              </AppText>
            }
            ListHeaderComponent={
              view !== null && olderLeftOut(view.messages) ? (
                <AppText className="text-sm text-foreground-muted">
                  Showing the newest {ROOM_READ_LIMIT} messages.
                </AppText>
              ) : undefined
            }
          />
          {task === undefined ? (
            <AppText className="px-5 pb-4 text-foreground-muted">
              This task is not on this computer's list.
            </AppText>
          ) : (
            <RoomComposer
              environmentId={environmentId}
              place={place}
              me={me}
              targets={targets}
              onPosted={(message) => {
                apply(message);
                refresh();
              }}
            />
          )}
        </KeyboardAvoidingView>
      </SettingsScreen>
    </>
  );
}

function RoomOnStatus(props: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly projectId: string;
  readonly taskId: string;
}) {
  const live = useEnvironmentQuery(
    serverEnvironment.peerHubLive({ environmentId: props.environmentId, input: {} }),
  );
  // The gate above holds this until the status has arrived.
  return live.data === null ? null : <Room {...props} status={live.data} />;
}

export function RoomRouteScreen({
  route,
}: StaticScreenProps<{
  environmentId: string;
  workspace: string;
  project: string;
  task: string;
}>) {
  const environmentId = EnvironmentId.make(route.params.environmentId);
  return (
    <PeerPluginGate environmentId={environmentId} plugin="rooms" title="Task rooms">
      <RoomOnStatus
        environmentId={environmentId}
        workspace={route.params.workspace}
        projectId={route.params.project}
        taskId={route.params.task}
      />
    </PeerPluginGate>
  );
}
