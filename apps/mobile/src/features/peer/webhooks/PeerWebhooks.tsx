import { useState } from "react";
import { Pressable, View } from "react-native";
import type { EnvironmentId, PeerWebhook } from "@t3tools/contracts";
import {
  administeredWorkspaces,
  canRequeue,
  eventLabel,
  failureSentence,
  orderWebhooks,
  webhookStatus,
  WEBHOOK_STATUS_LABELS,
  webhookActionMessage,
} from "@t3tools/client-runtime/peer/webhooks";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../../components/AppText";
import { useEnvironmentQuery } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import { SettingsSection } from "../../settings/components/SettingsSection";
import type { PeerSectionProps } from "../slotTypes";
import { webhookAtoms } from "./atoms";

export function PeerWebhooks({ environmentId, status }: PeerSectionProps) {
  return administeredWorkspaces(status).map((workspace) => (
    <WorkspaceWebhooks
      key={workspace.slug}
      environmentId={environmentId}
      workspace={workspace.slug}
      name={workspace.name}
    />
  ));
}
function WorkspaceWebhooks({
  environmentId,
  workspace,
  name,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly name: string;
}) {
  const [open, setOpen] = useState(false);
  const query = useEnvironmentQuery(
    open ? webhookAtoms.list({ environmentId, input: { workspace } }) : null,
  );
  return (
    <SettingsSection title={`Webhooks · ${name}`}>
      <View className="gap-3 p-4">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen(!open)}
          className="py-2"
        >
          <Text className="text-primary">{open ? "Hide webhooks" : "Show webhooks"}</Text>
        </Pressable>
        {open ? (
          <>
            <Text className="text-sm text-foreground-muted">
              Destinations are configured by your Hub administrator.
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={query.isPending}
              onPress={query.refresh}
              className="py-2"
            >
              <Text className="text-primary">Refresh</Text>
            </Pressable>
            {query.error ? (
              <Text accessibilityRole="alert" className="text-foreground">
                {query.error}
              </Text>
            ) : null}
            {query.isPending && !query.data ? (
              <Text className="text-foreground-muted">Loading webhooks…</Text>
            ) : null}
            {query.data?.webhooks.length === 0 ? (
              <Text className="text-foreground-muted">
                No webhooks. Ask your Hub administrator to configure a destination.
              </Text>
            ) : null}
            {orderWebhooks(query.data?.webhooks ?? []).map((webhook) => (
              <WebhookHealth
                key={webhook.id}
                environmentId={environmentId}
                workspace={workspace}
                webhook={webhook}
                onRefresh={query.refresh}
              />
            ))}
          </>
        ) : null}
      </View>
    </SettingsSection>
  );
}
function WebhookHealth({
  environmentId,
  workspace,
  webhook,
  onRefresh,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly webhook: PeerWebhook;
  readonly onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const requeue = useAtomCommand(webhookAtoms.requeue, { reportFailure: false });
  const test = useAtomCommand(webhookAtoms.test, { reportFailure: false });
  async function act(action: "test" | "requeue") {
    setBusy(true);
    setMessage(null);
    try {
      const input = { environmentId, input: { workspace, id: webhook.id } };
      const result = action === "test" ? await test(input) : await requeue(input);
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          setMessage(error instanceof Error ? error.message : String(error));
        }
      } else {
        setMessage(webhookActionMessage(result.value));
        onRefresh();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <View className="gap-2 border-t border-border pt-3">
      <Text className="font-t3-medium text-foreground">
        {webhook.id} · {WEBHOOK_STATUS_LABELS[webhookStatus(webhook)]}
      </Text>
      <Text className="text-sm text-foreground-muted">
        {webhook.destination.host ?? "Destination needs setup"} ·{" "}
        {webhook.events.map(eventLabel).join(" · ")}
      </Text>
      <Text className="text-foreground">
        {webhook.health.failed} failed · {webhook.health.pending} pending
      </Text>
      {webhook.health.lastFailure ? (
        <Text className="text-sm text-foreground-muted">
          {failureSentence(webhook.health.lastFailure)}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy || !canRequeue(webhook) }}
        disabled={busy || !canRequeue(webhook)}
        onPress={() => void act("requeue")}
        className="py-2"
      >
        <Text className="text-primary">Requeue failed</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{
          disabled:
            busy ||
            !webhook.enabled ||
            webhook.destination.state !== "ok" ||
            webhook.signing === "missing",
        }}
        disabled={
          busy ||
          !webhook.enabled ||
          webhook.destination.state !== "ok" ||
          webhook.signing === "missing"
        }
        onPress={() => void act("test")}
        className="py-2"
      >
        <Text className="text-primary">Send test</Text>
      </Pressable>
      {message ? (
        <Text accessibilityRole="alert" className="text-foreground">
          {message}
        </Text>
      ) : null}
    </View>
  );
}
