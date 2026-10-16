import type {
  EnvironmentId,
  PeerAuditEntry,
  PeerAuditPage,
  PeerWorkspaceState,
} from "@t3tools/contracts";
import { describeAuditEntry } from "@t3tools/client-runtime/peer-audit";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../../components/ui/AppText";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import type { PeerSectionProps } from "../slotTypes";

function WorkspaceAudit({
  environmentId,
  workspace,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: PeerWorkspaceState;
}) {
  const list = useAtomCommand(serverEnvironment.peerAuditList, { reportFailure: false });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState<PeerAuditPage | null>(null);
  const [entries, setEntries] = useState<ReadonlyArray<PeerAuditEntry>>([]);
  const [error, setError] = useState<string | null>(null);
  const load = async (before?: number) => {
    setBusy(true);
    setError(null);
    if (before === undefined) {
      setPage(null);
      setEntries([]);
    }
    try {
      const result = await list({
        environmentId,
        input: { workspace: workspace.slug, ...(before === undefined ? {} : { before }) },
      });
      if (result._tag === "Success") {
        setPage(result.value);
        setEntries((current) =>
          before === undefined ? result.value.entries : [...current, ...result.value.entries],
        );
      } else if (!isAtomCommandInterrupted(result)) {
        const cause = squashAtomCommandFailure(result);
        setError(cause instanceof Error ? cause.message : String(cause));
        setPage(null);
        setEntries([]);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <View className="gap-3">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open, disabled: busy }}
        disabled={busy}
        onPress={() => {
          setOpen(!open);
          if (!open) void load();
        }}
      >
        <Text className="text-primary">Audit log · {workspace.name}</Text>
      </Pressable>
      {!open ? null : (
        <View className="gap-2">
          {busy ? <Text className="text-foreground-muted">Loading…</Text> : null}
          {error ? (
            <>
              <Text accessibilityRole="alert" className="text-destructive">
                {error}
              </Text>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => void load()}>
                <Text className="text-primary">Retry</Text>
              </Pressable>
            </>
          ) : null}
          {page?.unsupported ? (
            <Text className="text-foreground-muted">
              This hub keeps no audit log. Update Peer Hub to record workspace changes.
            </Text>
          ) : page && entries.length === 0 ? (
            <Text className="text-foreground-muted">No changes recorded.</Text>
          ) : null}
          {entries.map((entry) => (
            <View key={entry.seq}>
              <Text className="text-foreground">{describeAuditEntry(entry)}</Text>
              <Text className="text-sm text-foreground-muted">{entry.at}</Text>
            </View>
          ))}
          {page?.next ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void load(page.next ?? undefined)}
            >
              <Text className="text-primary">Load older</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}
export function AuditLogSection({ environmentId, status }: PeerSectionProps) {
  return (
    <View className="gap-4">
      {status.workspaces
        .filter((workspace) => workspace.role !== "member")
        .map((workspace) => (
          <WorkspaceAudit
            key={workspace.slug}
            environmentId={environmentId}
            workspace={workspace}
          />
        ))}
    </View>
  );
}
