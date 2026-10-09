import type { EnvironmentId, PeerHubSetCoordinationInput } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "../settings/components/SettingsSection";
import { useSettingsEnvironmentFilter } from "../settings/settings-environment-filter";
import { PeerDomainOffers } from "./PeerDomainOffers";
import { PeerAdapters } from "./PeerAdapters";
import { PeerCoordTimeline } from "./PeerCoordTimeline";
import { PeerPluginsSection } from "./PeerPluginsSection";
import { usePeerMobilePlugins } from "./slots";
import { workspaceSectionsAt } from "./slots.logic";

/**
 * Peer workspaces for each environment selected in Settings: the team's open tasks, then what the
 * active plugins add (team requests, starting an agent on the selected task, the agents herdr
 * runs), the coordination of the selected task, how agents coordinate, and the plugins themselves.
 */
export function PeerWorkspaces() {
  const { selectedTargets } = useSettingsEnvironmentFilter();
  if (selectedTargets.length === 0) {
    return (
      <Text className="text-foreground-muted">Connect an environment to work with your team.</Text>
    );
  }
  return selectedTargets.map((target) => (
    <PeerEnvironment
      key={target.environmentId}
      environmentId={target.environmentId}
      label={target.label}
    />
  ));
}

/** Remote launch uses the selected environment's runtime and filesystem. */
function PeerEnvironment({
  environmentId,
  label,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}) {
  const query = useEnvironmentQuery(serverEnvironment.peerHubLive({ environmentId, input: {} }));
  const coordinate = useAtomCommand(serverEnvironment.peerHubSetCoordination, {
    reportFailure: false,
  });
  const [selection, setSelection] = useState<{
    workspace: string;
    projectId: string;
    taskId: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const status = query.data;
  const plugins = usePeerMobilePlugins(status);
  const project = status?.workspaces
    .find((workspace) => workspace.slug === selection?.workspace)
    ?.projects.find((project) => project.project.id === selection?.projectId);
  const task = project?.work.tasks.find((task) => task.id === selection?.taskId);
  const runCoordination = (input: PeerHubSetCoordinationInput) => {
    setBusy(true);
    setMessage(null);
    void coordinate({ environmentId, input })
      .then((result) => {
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          setMessage(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => setBusy(false));
  };
  return (
    <View className="gap-4">
      <Text className="text-lg font-t3-semibold text-foreground">{label}</Text>
      {query.error !== null ? (
        <Text accessibilityRole="alert" className="text-destructive">
          {query.error}
        </Text>
      ) : null}
      {status === null ? (
        <Text className="text-foreground-muted">
          {query.error === null
            ? "Loading workspaces…"
            : "Reconnect the environment and try again."}
        </Text>
      ) : !status.signedIn ? (
        <Text className="text-foreground-muted">
          Sign in to Peer workspaces on this environment using web or desktop first.
        </Text>
      ) : (
        <>
          <PeerDomainOffers environmentId={environmentId} status={status} />
          {status.workspaces.map((workspace) => (
            <SettingsSection key={workspace.slug} title={workspace.name}>
              {workspace.projects.flatMap((project) =>
                project.work.tasks
                  .filter((task) => task.status !== "done")
                  .map((task) => (
                    <Pressable
                      key={`${project.project.id}/${task.id}`}
                      accessibilityRole="button"
                      accessibilityState={{
                        selected:
                          selection?.taskId === task.id &&
                          selection?.projectId === project.project.id,
                        disabled: busy,
                      }}
                      disabled={busy}
                      className="gap-1 p-4"
                      onPress={() => {
                        setSelection({
                          workspace: workspace.slug,
                          projectId: project.project.id,
                          taskId: task.id,
                        });
                        setMessage(null);
                      }}
                    >
                      <Text className="font-t3-medium text-foreground">
                        {[task.key, task.title].filter(Boolean).join(" · ")}
                      </Text>
                      <Text className="text-sm text-foreground-muted">
                        {project.project.name} · {task.status}
                        {selection?.taskId === task.id &&
                        selection?.projectId === project.project.id
                          ? " · Selected"
                          : ""}
                      </Text>
                    </Pressable>
                  )),
              )}
              {workspace.projects.every((project) =>
                project.work.tasks.every((task) => task.status === "done"),
              ) ? (
                <Text className="p-4 text-foreground-muted">
                  No open tasks. Create a task in Peer on web or desktop.
                </Text>
              ) : null}
            </SettingsSection>
          ))}
          {workspaceSectionsAt(plugins, "tasks").map(({ key, Component }) => (
            <Component
              key={key}
              environmentId={environmentId}
              label={label}
              status={status}
              plugins={plugins}
            />
          ))}
          {task === undefined || project === undefined || selection === null
            ? null
            : plugins.map(({ id, taskSections: Section }) =>
                Section === undefined ? null : (
                  <Section
                    key={`${id}:${selection.workspace}/${task.id}`}
                    environmentId={environmentId}
                    label={label}
                    workspace={selection.workspace}
                    project={project}
                    task={task}
                    status={status}
                    onBusyChange={setBusy}
                    disabled={busy}
                  />
                ),
              )}
          {selection === null ? null : (
            <PeerCoordTimeline
              environmentId={environmentId}
              workspace={selection.workspace}
              project={selection.projectId}
              task={selection.taskId}
              revision={status.lastSyncAt ?? undefined}
              sessions={status.coordination.sessions.filter(
                (session) =>
                  session.workspace === selection.workspace &&
                  session.project === selection.projectId &&
                  session.task === selection.taskId,
              )}
              tasks={project?.work.tasks ?? []}
            />
          )}
          <PeerAdapters
            label={label}
            status={status}
            busy={busy}
            message={message}
            onCoordinate={runCoordination}
          />
          {workspaceSectionsAt(plugins, "end").map(({ key, Component }) => (
            <Component
              key={key}
              environmentId={environmentId}
              label={label}
              status={status}
              plugins={plugins}
            />
          ))}
          {status.workspaces.length === 0 ? (
            <Text className="text-foreground-muted">
              Join a workspace on this environment to see its tasks.
            </Text>
          ) : null}
        </>
      )}
      {status === null ? null : (
        <PeerPluginsSection environmentId={environmentId} label={label} status={status} />
      )}
    </View>
  );
}
