import { useAtomValue } from "@effect/atom-react";
import {
  TOOL_TRUST_CODEX_NOTICE,
  TOOL_TRUST_OWNER_MESSAGE,
  TOOL_TRUST_STDIO_NOTICE,
  toolTrustReview,
  toolTrustNeedsYouCount,
  toolTrustPermissions,
  toolTrustStateLabel,
} from "@t3tools/client-runtime/peer-tool-trust";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { PeerToolTrustSetSecretInput } from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { AppText as Text } from "../../../components/ui/AppText";
import { serverEnvironment } from "../../../state/server";
import { environmentSession } from "../../../state/session";
import { useAtomCommand } from "../../../state/use-atom-command";
import { SettingsSection } from "../../settings/components/SettingsSection";
import type { PeerSectionProps } from "../slotTypes";

function SecretEntry({
  name,
  source,
  environmentSet,
  busy,
  onSet,
}: {
  name: string;
  source: string;
  environmentSet: boolean;
  busy: boolean;
  onSet: (source: PeerToolTrustSetSecretInput["source"]) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <View className="gap-2">
      <Text className="text-foreground">
        {name} · {source} · environment {environmentSet ? "set" : "not set"}
      </Text>
      <TextInput
        accessibilityLabel={`Secret ${name}`}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        value={value}
        onChangeText={setValue}
        editable={!busy}
        className="rounded-xl border border-border p-3 text-foreground"
      />
      <View className="flex-row flex-wrap gap-3">
        <Pressable
          accessibilityRole="button"
          disabled={busy || value.length === 0}
          onPress={() => {
            const entered = value;
            setValue("");
            onSet({ kind: "value", value: entered });
          }}
        >
          <Text className="text-primary">Store value</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => onSet({ kind: "environment" })}
        >
          <Text className="text-primary">Use environment variable</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => onSet({ kind: "none" })}
        >
          <Text className="text-foreground-muted">Forget</Text>
        </Pressable>
      </View>
    </View>
  );
}
/** Local trust for tools, controlled on this environment from the device's session scopes. */
export function ToolTrustSection({ environmentId, status }: PeerSectionProps) {
  const session = useAtomValue(environmentSession.sessionStateValueAtom(environmentId));
  const permissions = toolTrustPermissions(session);
  const approve = useAtomCommand(serverEnvironment.peerToolTrustApprove, { reportFailure: false });
  const turnOff = useAtomCommand(serverEnvironment.peerToolTrustTurnOff, { reportFailure: false });
  const setSecret = useAtomCommand(serverEnvironment.peerToolTrustSetSecret, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<AtomCommandResult<unknown, unknown>>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      setBusy(false);
    }
  };
  const groups = toolTrustReview(status);
  const count = toolTrustNeedsYouCount(status);
  const approvals = groups.flatMap((group) =>
    group.tools.flatMap((row) =>
      row.fingerprint === undefined || row.state === "on" || row.state === "invalid"
        ? []
        : [{ workspace: row.workspace, tool: row.tool, fingerprint: row.fingerprint }],
    ),
  );
  const offItems = [
    ...new Map(
      groups.flatMap((group) =>
        group.tools.map(
          (row) =>
            [`${row.workspace}/${row.tool}`, { workspace: row.workspace, tool: row.tool }] as const,
        ),
      ),
    ).values(),
  ];
  return (
    <SettingsSection title="Tools on this computer">
      <View className="gap-4 p-4">
        <Text className="text-foreground">
          {count} {count === 1 ? "tool needs" : "tools need"} review or a secret.
        </Text>
        <Text className="text-sm text-foreground-muted">{TOOL_TRUST_CODEX_NOTICE}</Text>
        {permissions.approve ? null : (
          <Text className="text-foreground-muted">{TOOL_TRUST_OWNER_MESSAGE}</Text>
        )}
        {error === null ? null : (
          <Text accessibilityRole="alert" className="text-foreground">
            {error}
          </Text>
        )}
        {status.toolTrust?.error === undefined ? null : (
          <Text accessibilityRole="alert" className="text-foreground">
            {status.toolTrust.error}
          </Text>
        )}
        <View className="flex-row gap-3">
          {permissions.approve ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy || approvals.length === 0 || approvals.length > 64}
              onPress={() =>
                void run(() => approve({ environmentId, input: { items: approvals } }))
              }
            >
              <Text className="text-primary">Approve all</Text>
            </Pressable>
          ) : null}
          {permissions.turnOff ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy || offItems.length === 0 || offItems.length > 64}
              onPress={() => void run(() => turnOff({ environmentId, input: { items: offItems } }))}
            >
              <Text className="text-primary">Keep all off</Text>
            </Pressable>
          ) : null}
        </View>
        {groups.map((group) => (
          <View key={group.workspace} className="gap-4">
            <Text className="text-lg font-t3-medium text-foreground">
              {group.name} · {group.workspace}
            </Text>
            {group.appliedBy === undefined ? null : (
              <Text className="text-sm text-foreground-muted">
                Applied by {group.appliedBy}
                {group.appliedAt === undefined ? "" : ` · ${group.appliedAt}`}
              </Text>
            )}
            {group.tools.map((row) => (
              <View key={row.key} className="gap-2 rounded-xl border border-border p-3">
                <Text className="font-t3-medium text-foreground">
                  {row.name} · {toolTrustStateLabel[row.state]}
                </Text>
                <Text className="text-sm text-foreground-muted">
                  {row.projects.join(", ")} · {row.providers.join(", ")}
                </Text>
                {row.review.transport === "stdio" ? (
                  <>
                    <Text selectable className="text-sm text-foreground">
                      {row.review.command}
                      {"\n"}
                      {row.review.args.join("\n")}
                      {"\n"}
                      {row.review.env.map(([name, value]) => `${name}=${value}`).join("\n")}
                    </Text>
                    <Text className="text-sm text-foreground-muted">{TOOL_TRUST_STDIO_NOTICE}</Text>
                  </>
                ) : (
                  <>
                    <Text selectable className="text-foreground">
                      {row.review.url}
                    </Text>
                    {row.review.headers.map((header) => (
                      <Text key={header.name} className="text-foreground">
                        Header {header.name}
                        {header.secrets.length === 0
                          ? ""
                          : ` · secrets ${header.secrets.join(", ")}`}
                      </Text>
                    ))}
                  </>
                )}
                {row.reason === undefined ? null : (
                  <Text className="text-foreground">{row.reason}</Text>
                )}
                {row.changes.length === 0 ? null : (
                  <Text className="text-foreground">Changed: {row.changes.join(", ")}</Text>
                )}
                {row.missing.length === 0 ? null : (
                  <Text className="text-foreground">Needs secrets: {row.missing.join(", ")}</Text>
                )}
                <View className="flex-row gap-3">
                  {permissions.approve &&
                  row.fingerprint !== undefined &&
                  row.state !== "invalid" &&
                  row.state !== "on" ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() =>
                        void run(() =>
                          approve({
                            environmentId,
                            input: {
                              items: [
                                {
                                  workspace: row.workspace,
                                  tool: row.tool,
                                  fingerprint: row.fingerprint!,
                                },
                              ],
                            },
                          }),
                        )
                      }
                    >
                      <Text className="text-primary">
                        {row.state === "off" ? "Turn on" : "Approve"}
                      </Text>
                    </Pressable>
                  ) : null}
                  {permissions.turnOff && row.state !== "off" ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() =>
                        void run(() =>
                          turnOff({
                            environmentId,
                            input: { items: [{ workspace: row.workspace, tool: row.tool }] },
                          }),
                        )
                      }
                    >
                      <Text className="text-primary">Turn off</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ))}
            {group.secrets.map((secret) =>
              permissions.approve ? (
                <SecretEntry
                  key={secret.name}
                  {...secret}
                  busy={busy}
                  onSet={(source) =>
                    void run(() =>
                      setSecret({
                        environmentId,
                        input: { workspace: group.workspace, name: secret.name, source },
                      }),
                    )
                  }
                />
              ) : (
                <Text key={secret.name} className="text-foreground-muted">
                  {secret.name} · {secret.source} · environment{" "}
                  {secret.environmentSet ? "set" : "not set"}
                </Text>
              ),
            )}
          </View>
        ))}
      </View>
    </SettingsSection>
  );
}
