import type { EnvironmentId, PeerAgentRequest, PeerHubStatus } from "@t3tools/contracts";
import { incomingPeerRequests } from "@t3tools/client-runtime/peer-requests";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { uuidv4 } from "../../lib/uuid";
import { useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { AppText as Text } from "../../components/AppText";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "./components/SettingsSection";
import { PeerTaskLaunch } from "./PeerTaskLaunch";

export function PeerTeamRequests({
  environmentId,
  label,
  status,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly status: PeerHubStatus;
}) {
  const send = useAtomCommand(serverEnvironment.peerHubSendRequest, { reportFailure: false });
  const dismiss = useAtomCommand(serverEnvironment.peerHubDismissRequest, { reportFailure: false });
  const [selected, setSelected] = useState<{ workspace: string; request: PeerAgentRequest } | null>(
    null,
  );
  const [scope, setScope] = useState<{ workspace: string; projectId: string } | null>(null);
  const [recipient, setRecipient] = useState("");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const op = useRef<{ draft: string; id: string } | null>(null);
  const project = status.workspaces
    .find((w) => w.slug === selected?.workspace)
    ?.projects.find((p) => p.project.id === selected?.request.project);
  const task = project?.work.tasks.find((t) => t.id === selected?.request.task);
  return (
    <>
      <SettingsSection title="Needs you · team requests">
        <View className="gap-4 p-4">
          {incomingPeerRequests(status).map((row) => (
            <View key={`${row.workspace}/${row.request.id}`} className="gap-2">
              <Text className="font-t3-medium text-foreground">{row.request.title}</Text>
              <Text className="text-sm text-foreground-muted">
                {row.request.sender} · {row.workspace}
              </Text>
              <Text className="text-foreground">{row.request.prompt}</Text>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => setSelected(row)}
              >
                <Text className="text-primary">Review request</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => {
                  setBusy(true);
                  setMessage(null);
                  void dismiss({
                    environmentId,
                    input: {
                      workspace: row.workspace,
                      projectId: row.request.project,
                      requestId: row.request.id,
                    },
                  })
                    .then((result) => {
                      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
                        const error = squashAtomCommandFailure(result);
                        setMessage(error instanceof Error ? error.message : String(error));
                      }
                    })
                    .finally(() => setBusy(false));
                }}
              >
                <Text className="text-foreground-muted">Dismiss</Text>
              </Pressable>
            </View>
          ))}
          {(status.requests ?? [])
            .filter(
              (row) => row.request.recipient === status.email && row.request.status === "accepted",
            )
            .map(({ workspace, request }) => (
              <View key={`${workspace}/${request.id}`} className="gap-1">
                <Text className="font-t3-medium text-foreground">Accepted · {request.title}</Text>
                <Text className="text-sm text-foreground-muted">
                  Inspect the task and herdr before starting another agent.
                </Text>
                <Text className="text-foreground">{request.prompt}</Text>
              </View>
            ))}
          {incomingPeerRequests(status).length === 0 ? (
            <Text className="text-foreground-muted">No pending team requests.</Text>
          ) : null}
        </View>
      </SettingsSection>
      {selected === null || project === undefined || task === undefined ? null : (
        <PeerTaskLaunch
          key={`${selected.workspace}/${selected.request.id}`}
          environmentId={environmentId}
          label={label}
          workspace={selected.workspace}
          project={project}
          task={task}
          status={status}
          request={selected.request}
          onBusyChange={setBusy}
          disabled={busy}
        />
      )}
      <SettingsSection title="Request a teammate">
        <View className="gap-3 p-4">
          {status.workspaces.flatMap((workspace) =>
            workspace.projects.map((project) => (
              <Pressable
                key={`${workspace.slug}/${project.project.id}`}
                accessibilityRole="button"
                disabled={busy}
                accessibilityState={{
                  selected:
                    scope?.workspace === workspace.slug && scope.projectId === project.project.id,
                }}
                onPress={() => {
                  setScope({ workspace: workspace.slug, projectId: project.project.id });
                  setMessage(null);
                }}
              >
                <Text className="text-primary">
                  {workspace.name} · {project.project.name}
                </Text>
              </Pressable>
            )),
          )}
          {scope === null ? null : (
            <>
              <TextInput
                accessibilityLabel="Teammate workspace email"
                placeholder="Teammate's workspace email"
                keyboardType="email-address"
                autoCapitalize="none"
                value={recipient}
                onChangeText={setRecipient}
                editable={!busy}
                className="rounded-xl border border-border p-3 text-foreground"
              />
              <TextInput
                accessibilityLabel="Request title"
                placeholder="Task title"
                maxLength={120}
                value={title}
                onChangeText={setTitle}
                editable={!busy}
                className="rounded-xl border border-border p-3 text-foreground"
              />
              <TextInput
                accessibilityLabel="Request prompt"
                placeholder="Request"
                multiline
                maxLength={20_000}
                value={prompt}
                onChangeText={setPrompt}
                editable={!busy}
                className="min-h-24 rounded-xl border border-border p-3 text-foreground"
              />
              <Pressable
                accessibilityRole="button"
                disabled={busy || !recipient.trim() || !title.trim() || !prompt.trim()}
                onPress={() => {
                  const draft = JSON.stringify([
                    scope,
                    recipient.trim(),
                    title.trim(),
                    prompt.trim(),
                  ]);
                  if (op.current?.draft !== draft) op.current = { draft, id: uuidv4() };
                  setBusy(true);
                  setMessage(null);
                  void send({
                    environmentId,
                    input: {
                      ...scope,
                      op: op.current.id,
                      recipient: recipient.trim(),
                      title: title.trim(),
                      prompt: prompt.trim(),
                    },
                  })
                    .then((result) => {
                      if (result._tag === "Success") {
                        setMessage("Sent. Your teammate can accept the request in Needs you.");
                        setScope(null);
                        setTitle("");
                        setPrompt("");
                        op.current = null;
                      } else if (!isAtomCommandInterrupted(result)) {
                        const error = squashAtomCommandFailure(result);
                        setMessage(error instanceof Error ? error.message : String(error));
                      }
                    })
                    .finally(() => setBusy(false));
                }}
              >
                <Text className="text-primary">{busy ? "Sending…" : "Send request"}</Text>
              </Pressable>
            </>
          )}
          {message === null ? null : (
            <Text accessibilityRole="alert" className="text-foreground-muted">
              {message}
            </Text>
          )}
        </View>
      </SettingsSection>
    </>
  );
}
