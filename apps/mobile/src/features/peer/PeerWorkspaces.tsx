import { LocalWork } from "./LocalWork";
import { NeedsYouAlertsRow } from "./needs-you/NeedsYouAlertsRow";
import {
  editionLabel,
  type EnvironmentId,
  type PeerHubSetCoordinationInput,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { domainStateLabel } from "@t3tools/client-runtime/peer-domain-offers";
import { useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsRow } from "../settings/components/SettingsRow";
import { SettingsSection } from "../settings/components/SettingsSection";
import { useSettingsEnvironmentFilter } from "../settings/settings-environment-filter";
import { PeerAccessControls } from "./PeerAccessControls";
import { PeerDomainOffers } from "./PeerDomainOffers";
import { PeerFoundings } from "./PeerFoundings";
import { PeerSignIn } from "./PeerSignIn";
import { organizationLine } from "./organizationLine.logic";
import { PeerAdapters } from "./PeerAdapters";
import { PeerCoordTimeline } from "./PeerCoordTimeline";
import { PeerPluginsSection } from "./PeerPluginsSection";
import { usePeerMobilePlugins, PEER_MOBILE_PLUGINS } from "./slots";
import { alwaysWorkspaceSectionsAt, workspaceSectionsAt } from "./slots.logic";

/**
 * Peer workspaces: the way to Work, then for each environment selected in Settings the team's open
 * tasks, what the active plugins add (team requests, starting an agent on the selected task, the
 * agents herdr runs), the coordination of the selected task, how agents coordinate, and the
 * plugins themselves.
 */
export function PeerWorkspaces() {
  const { selectedTargets } = useSettingsEnvironmentFilter();
  if (selectedTargets.length === 0) {
    return (
      <Text className="text-foreground-muted">Connect an environment to work with your team.</Text>
    );
  }
  return (
    <>
      <WorkRow />
      {selectedTargets.map((target) => (
        <PeerEnvironment
          key={target.environmentId}
          environmentId={target.environmentId}
          label={target.label}
        />
      ))}
    </>
  );
}

/** Opens Work: the team's projects and their threads, over every computer the phone knows. */
function WorkRow() {
  const navigation = useNavigation();
  return (
    <SettingsSection>
      <SettingsRow
        icon="square.split.2x1"
        label="Work"
        value="Projects and threads"
        onPress={() => navigation.navigate("Work")}
      />
    </SettingsSection>
  );
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
  const Preparation = plugins.find((plugin) => plugin.taskPreparation)?.taskPreparation;
  const hasLauncher = plugins.some((plugin) => plugin.taskLauncher !== undefined);
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
      ) : (
        <>
          {status.signedIn ? null : <PeerSignIn environmentId={environmentId} status={status} />}
          <LocalWork status={status} />
          {status.signedIn ? (
            <PeerAccessControls environmentId={environmentId} status={status} />
          ) : null}
          {status.needsYou === undefined &&
          !status.plugins?.some((plugin) => plugin.id === "needs-you") ? (
            <NeedsYouAlertsRow environmentId={environmentId} label={label} status={status} />
          ) : null}
          <PeerFoundings environmentId={environmentId} status={status} />
          <PeerDomainOffers environmentId={environmentId} status={status} />
          {status.workspaces.map((workspace) => (
            <SettingsSection key={workspace.slug} title={workspace.name}>
              <Text className="p-4 text-sm text-foreground-muted">
                {organizationLine(workspace, status.workspaces.length)}
              </Text>
              <Text className="p-4 text-sm text-foreground-muted">
                {editionLabel(workspace.edition)}
              </Text>
              {workspace.domainClaims?.length ? (
                <Text className="p-4 text-sm text-foreground-muted">
                  {workspace.domainClaims
                    .map((claim) => domainStateLabel(claim.state, claim.domain))
                    .join(" · ")}
                </Text>
              ) : null}
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
                      {plugins.map(({ id, taskBadges: Badge }) =>
                        Badge ? (
                          <Badge
                            key={id}
                            environmentId={environmentId}
                            label={label}
                            workspace={workspace.slug}
                            project={project}
                            task={task}
                            status={status}
                            disabled={busy}
                            onBusyChange={setBusy}
                          />
                        ) : null,
                      )}
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
          {[
            ...workspaceSectionsAt(plugins, "tasks"),
            ...alwaysWorkspaceSectionsAt(PEER_MOBILE_PLUGINS, status, "tasks"),
          ].map(({ key, Component }) => (
            <Component
              key={key}
              environmentId={environmentId}
              label={label}
              status={status}
              plugins={plugins}
            />
          ))}
          {task !== undefined &&
          project !== undefined &&
          selection !== null &&
          Preparation !== undefined &&
          !hasLauncher ? (
            <Preparation
              key={`preparation:${selection.workspace}/${project.project.id}/${task.id}`}
              environmentId={environmentId}
              label={label}
              workspace={selection.workspace}
              project={project}
              task={task}
              status={status}
            />
          ) : null}
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
                    taskPreparation={Preparation}
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
          {[
            ...workspaceSectionsAt(plugins, "end"),
            ...alwaysWorkspaceSectionsAt(PEER_MOBILE_PLUGINS, status, "end"),
          ].map(({ key, Component }) => (
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
              Optional: connect Peer Hub from web or desktop to coordinate across your team’s
              computers. Local chats and coordination remain available here.
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
