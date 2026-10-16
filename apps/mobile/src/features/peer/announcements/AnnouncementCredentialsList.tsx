import { useState } from "react";
import { View, Pressable } from "react-native";
import type { EnvironmentId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../../components/ui/AppText";
import { useEnvironmentQuery } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import { announcementAtoms } from "./atoms";
export function AnnouncementCredentialsList({
  environmentId,
  workspace,
  project,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly project: string;
}) {
  const query = useEnvironmentQuery(
    announcementAtoms.credentials({ environmentId, input: { workspace, project } }),
  );
  const revoke = useAtomCommand(announcementAtoms.revokeCredential, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function remove(id: string) {
    setBusy(true);
    try {
      const result = await revoke({ environmentId, input: { workspace, project, id } });
      if (result._tag === "Failure") {
        const failure = squashAtomCommandFailure(result);
        setMessage(failure instanceof Error ? failure.message : String(failure));
      } else query.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <View className="gap-2 border-t border-border pt-3">
      <Text className="font-t3-medium text-foreground">Announcement credentials</Text>
      <Text className="text-sm text-foreground-muted">
        Create credentials on the web or desktop.
      </Text>
      {query.error ? (
        <Text accessibilityRole="alert" className="text-foreground">
          {query.error}
        </Text>
      ) : null}
      {query.data?.credentials.map((row) => (
        <View key={row.id} className="gap-1">
          <Text className="text-sm text-foreground">
            {row.label} · {row.createdBy} · {row.status} · expires{" "}
            {new Date(row.expiresAt).toLocaleDateString()} · last used{" "}
            {row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleString() : "never"}
          </Text>
          {row.status === "active" ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void remove(row.id)}
              className="py-2"
            >
              <Text className="text-primary">Revoke</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
      {message ? (
        <Text accessibilityRole="alert" className="text-foreground">
          {message}
        </Text>
      ) : null}
    </View>
  );
}
