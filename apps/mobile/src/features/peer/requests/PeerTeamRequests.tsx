import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { uuidv4 } from "../../../lib/uuid";
import { useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { AppText as Text } from "../../../components/AppText";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { SettingsSection } from "../../settings/components/SettingsSection";
import type { PeerSectionProps } from "../slotTypes";
import { SentRequests } from "./SentRequests";

/** Ask a teammate to take a task; incoming requests live in Needs you. */
export function PeerTeamRequests({ environmentId, status }: PeerSectionProps) {
  const send = useAtomCommand(serverEnvironment.peerHubSendRequest, { reportFailure: false });
  const [scope, setScope] = useState<{ workspace: string; projectId: string } | null>(null);
  const [recipient, setRecipient] = useState("");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const op = useRef<{ draft: string; id: string } | null>(null);
  return (
    <>
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
      <SentRequests environmentId={environmentId} status={status} />
    </>
  );
}
